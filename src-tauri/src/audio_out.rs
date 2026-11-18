//! The game's sound, played by the app itself instead of by the webview.
//!
//! The page still makes all of its sound with Web Audio (src/audio/AudioEngine.ts), but in the
//! desktop app it does not play it: the finished mix is streamed here (src/audio/native/) and played
//! through the system's audio output from this process. So the sound belongs to the game's own
//! process, `soundwave.exe`, not to a webview helper process: the system's volume mixer, per-app
//! output routing (SteelSeries Sonar, Boom3D, Windows' own "App volume and device preferences") and
//! window capture in screen-sharing and streaming apps all see it as the game's.
//!
//! The page pushes stereo float frames to `http://swaudio.localhost/push` (a custom protocol, so it
//! can be reached from a worker without the main thread). They wait in a short queue and the output
//! stream takes them from there, resampled to the device's rate. The queue is held near a target
//! length by playing a hair faster or slower, so the two clocks (the page's and the sound card's)
//! never drift apart. Each push is answered with how long the newest frame will take to be heard, and
//! the page uses that to keep the game's clock on what the player hears.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// How much sound the queue aims to hold, seconds: enough to ride out a late delivery from the page.
const TARGET_S: f64 = 0.04;
/// Past this, seconds, the queue is cut back to its target at once (the page delivered a burst).
const CUT_S: f64 = 0.2;
/// Most the playback speed is bent to keep the queue at its target: a tenth of a per cent, far below hearing.
const MAX_BEND: f64 = 0.001;
/// How often the output thread looks for a new default device, or for the chosen one coming back.
const WATCH: Duration = Duration::from_secs(2);

#[derive(Default)]
struct Shared {
    /// Stereo frames waiting to be played, at the page's sample rate.
    queue: Mutex<VecDeque<[f32; 2]>>,
    /// The page's sample rate (0 until the first push).
    in_rate: AtomicU32,
    /// When the output last took frames, and how long from then until the end of what it took is
    /// heard (its buffer and the device's latency), microseconds.
    last_take: Mutex<Option<Instant>>,
    ahead_us: AtomicU64,
    /// The output to play through (empty: the system default).
    wanted: Mutex<String>,
    /// The output stream is to be opened again (the wanted device changed, or the stream failed).
    reopen: AtomicBool,
    started: AtomicBool,
}

#[derive(Default)]
pub struct NativeAudio {
    shared: Arc<Shared>,
}

#[allow(deprecated)]
fn device_name(d: &cpal::Device) -> String {
    d.name().unwrap_or_default()
}

/// The device to play through: the wanted one when it is connected, else the system's default.
fn pick(host: &cpal::Host, wanted: &str) -> Option<cpal::Device> {
    if !wanted.is_empty()
        && let Ok(mut all) = host.output_devices()
        && let Some(d) = all.find(|d| device_name(d) == wanted)
    {
        return Some(d);
    }
    host.default_output_device()
}

/// Reads the queue into the device's buffer, resampling as it goes.
struct Reader {
    shared: Arc<Shared>,
    out_rate: f64,
    /// Position between `prev` and `next`, in input frames (0..1).
    frac: f64,
    prev: [f32; 2],
    next: [f32; 2],
    /// Waiting for the queue to fill up to its target before playing (at the start, and after it ran dry).
    priming: bool,
}

impl Reader {
    fn fill(&mut self, out: &mut [[f32; 2]]) {
        let in_rate = self.shared.in_rate.load(Ordering::Relaxed) as f64;
        let Ok(mut q) = self.shared.queue.lock() else {
            out.fill([0.0; 2]);
            return;
        };
        if in_rate <= 0.0 {
            out.fill([0.0; 2]);
            return;
        }
        let target = TARGET_S * in_rate;
        if q.len() as f64 > CUT_S * in_rate {
            let drop = q.len() - target as usize;
            q.drain(..drop);
        }
        if self.priming {
            if (q.len() as f64) < target {
                out.fill([0.0; 2]);
                return;
            }
            self.priming = false;
        }
        // A little faster when the queue is long, a little slower when it is short.
        let bend = ((q.len() as f64 - target) / target * MAX_BEND).clamp(-MAX_BEND, MAX_BEND);
        let step = in_rate / self.out_rate * (1.0 + bend);
        for (i, frame) in out.iter_mut().enumerate() {
            while self.frac >= 1.0 {
                match q.pop_front() {
                    Some(f) => {
                        self.prev = self.next;
                        self.next = f;
                        self.frac -= 1.0;
                    }
                    None => {
                        // Ran dry: silence until the page has caught up again.
                        self.priming = true;
                        out[i..].fill([0.0; 2]);
                        return;
                    }
                }
            }
            let t = self.frac as f32;
            *frame = [
                self.prev[0] + (self.next[0] - self.prev[0]) * t,
                self.prev[1] + (self.next[1] - self.prev[1]) * t,
            ];
            self.frac += step;
        }
    }
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    shared: &Arc<Shared>,
) -> Option<cpal::Stream>
where
    T: cpal::SizedSample + cpal::FromSample<f32>,
{
    let channels = config.channels as usize;
    let out_rate = config.sample_rate.0 as f64;
    let mut reader = Reader {
        shared: shared.clone(),
        out_rate,
        frac: 1.0,
        prev: [0.0; 2],
        next: [0.0; 2],
        priming: true,
    };
    let mut stereo: Vec<[f32; 2]> = Vec::new();
    let timing = shared.clone();
    let failed = shared.clone();
    let stream = device
        .build_output_stream(
            config,
            move |data: &mut [T], info: &cpal::OutputCallbackInfo| {
                let frames = data.len() / channels.max(1);
                stereo.resize(frames, [0.0; 2]);
                reader.fill(&mut stereo);
                for (out, &[l, r]) in data.chunks_mut(channels).zip(stereo.iter()) {
                    match out.len() {
                        0 => {}
                        1 => out[0] = T::from_sample((l + r) * 0.5),
                        _ => {
                            out[0] = T::from_sample(l);
                            out[1] = T::from_sample(r);
                            for x in &mut out[2..] {
                                *x = T::from_sample(0.0);
                            }
                        }
                    }
                }
                // How long from now until the last of these frames is heard.
                let ts = info.timestamp();
                let latency = ts.playback.duration_since(&ts.callback).unwrap_or_default();
                let ahead = latency + Duration::from_secs_f64(frames as f64 / out_rate);
                timing
                    .ahead_us
                    .store(ahead.as_micros() as u64, Ordering::Relaxed);
                if let Ok(mut at) = timing.last_take.lock() {
                    *at = Some(Instant::now());
                }
            },
            move |err| {
                log::warn!("audio output failed: {err}");
                failed.reopen.store(true, Ordering::SeqCst);
            },
            None,
        )
        .ok()?;
    stream.play().ok()?;
    Some(stream)
}

/// Opens an output stream on `device`, at the page's rate when the device takes it (no resampling).
fn open(device: &cpal::Device, shared: &Arc<Shared>) -> Option<cpal::Stream> {
    let in_rate = shared.in_rate.load(Ordering::Relaxed);
    let default = device.default_output_config().ok()?;
    let same_rate = device.supported_output_configs().ok().and_then(|mut all| {
        all.find(|c| {
            c.sample_format() == default.sample_format()
                && c.channels() == default.channels()
                && c.min_sample_rate().0 <= in_rate
                && in_rate <= c.max_sample_rate().0
        })
        .map(|c| c.with_sample_rate(cpal::SampleRate(in_rate)))
    });
    let chosen = same_rate.unwrap_or(default);
    let config: cpal::StreamConfig = chosen.config();
    log::info!(
        "audio output: {} at {} Hz, {} channels, {:?}",
        device_name(device),
        config.sample_rate.0,
        config.channels,
        chosen.sample_format()
    );
    match chosen.sample_format() {
        cpal::SampleFormat::F32 => build::<f32>(device, &config, shared),
        cpal::SampleFormat::I16 => build::<i16>(device, &config, shared),
        cpal::SampleFormat::I32 => build::<i32>(device, &config, shared),
        cpal::SampleFormat::U16 => build::<u16>(device, &config, shared),
        _ => None,
    }
}

impl NativeAudio {
    /// Starts the output thread, once, when the page first sends sound.
    fn start(&self) {
        if self.shared.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let shared = self.shared.clone();
        // The stream lives on its own thread: audio streams can't move between threads.
        thread::spawn(move || {
            let host = cpal::default_host();
            let mut stream: Option<cpal::Stream> = None;
            let mut playing_on = String::new();
            let mut checked = Instant::now() - WATCH;
            loop {
                // A change asked for is acted on at once; the devices are looked over every few seconds.
                let asked = shared.reopen.swap(false, Ordering::SeqCst);
                if asked || stream.is_none() || checked.elapsed() >= WATCH {
                    checked = Instant::now();
                    let wanted = shared.wanted.lock().map(|w| w.clone()).unwrap_or_default();
                    // The device that should be playing: the chosen one, or the default (which may have changed).
                    let device = pick(&host, &wanted);
                    let should = device.as_ref().map(device_name).unwrap_or_default();
                    if asked || stream.is_none() || should != playing_on {
                        stream = None;
                        playing_on.clear();
                        if let Some(device) = device {
                            stream = open(&device, &shared);
                            if stream.is_some() {
                                playing_on = should;
                            }
                        }
                    }
                }
                thread::sleep(Duration::from_millis(100));
            }
        });
    }

    /// Takes frames from the page: little-endian f32, stereo interleaved, at `rate`. Returns how
    /// long until the last of them is heard, seconds.
    fn push(&self, body: &[u8], rate: u32) -> f64 {
        let old = self.shared.in_rate.swap(rate, Ordering::Relaxed);
        if old != rate && old != 0 {
            // A new rate: what is queued is from the old one, and the stream may play it natively.
            if let Ok(mut q) = self.shared.queue.lock() {
                q.clear();
            }
            self.shared.reopen.store(true, Ordering::SeqCst);
        }
        self.start();
        let queued = match self.shared.queue.lock() {
            Ok(mut q) => {
                let (frames, _) = body.as_chunks::<8>();
                q.extend(frames.iter().map(|&[a, b, c, d, e, f, g, h]| {
                    [
                        f32::from_le_bytes([a, b, c, d]),
                        f32::from_le_bytes([e, f, g, h]),
                    ]
                }));
                q.len()
            }
            Err(_) => 0,
        };
        let since = self
            .shared
            .last_take
            .lock()
            .ok()
            .and_then(|t| *t)
            .map_or(Duration::ZERO, |t| t.elapsed());
        let ahead = Duration::from_micros(self.shared.ahead_us.load(Ordering::Relaxed))
            .saturating_sub(since);
        queued as f64 / rate.max(1) as f64 + ahead.as_secs_f64()
    }
}

/// Answers the page's requests on `http://swaudio.localhost/`: `POST /push?rate=48000` with sound.
pub fn handle(
    audio: &NativeAudio,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let reply = |status: u16, body: String| {
        tauri::http::Response::builder()
            .status(status)
            .header("Content-Type", "application/json")
            .header("Access-Control-Allow-Origin", "*")
            .body(body.into_bytes())
            .unwrap_or_default()
    };
    if request.uri().path() != "/push" {
        return reply(404, "{}".into());
    }
    let rate = request
        .uri()
        .query()
        .and_then(|q| q.split('&').find_map(|kv| kv.strip_prefix("rate=")))
        .and_then(|r| r.parse::<u32>().ok())
        .filter(|r| (8_000..=192_000).contains(r));
    let Some(rate) = rate else {
        return reply(400, "{}".into());
    };
    let behind = audio.push(request.body(), rate);
    reply(200, format!("{{\"behind\":{behind:.6}}}"))
}

#[derive(Serialize)]
pub struct OutputDevices {
    devices: Vec<String>,
    default: String,
}

/// The outputs the game can play through, by name, and which one is the system's default.
#[tauri::command]
pub fn audio_devices() -> OutputDevices {
    let host = cpal::default_host();
    let mut devices: Vec<String> = host
        .output_devices()
        .map(|all| {
            all.map(|d| device_name(&d))
                .filter(|n| !n.is_empty())
                .collect()
        })
        .unwrap_or_default();
    devices.dedup();
    let default = host
        .default_output_device()
        .map(|d| device_name(&d))
        .unwrap_or_default();
    OutputDevices { devices, default }
}

/// Plays through the output with this name ('' = the system's default). A device that is not
/// connected is waited for: the default plays until it is back. Returns whether it is connected now.
#[tauri::command]
pub fn audio_set_device(state: tauri::State<'_, NativeAudio>, name: String) -> bool {
    let connected = name.is_empty() || audio_devices().devices.contains(&name);
    if let Ok(mut w) = state.shared.wanted.lock()
        && *w != name
    {
        *w = name;
        state.shared.reopen.store(true, Ordering::SeqCst);
    }
    connected
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reader(shared: &Arc<Shared>, out_rate: f64) -> Reader {
        Reader {
            shared: shared.clone(),
            out_rate,
            frac: 1.0,
            prev: [0.0; 2],
            next: [0.0; 2],
            priming: true,
        }
    }

    fn queue(shared: &Arc<Shared>, frames: impl IntoIterator<Item = [f32; 2]>) {
        shared.queue.lock().unwrap().extend(frames);
    }

    #[test]
    fn waits_for_its_target_then_plays_frames_in_order() {
        let shared = Arc::new(Shared::default());
        shared.in_rate.store(1000, Ordering::Relaxed);
        let mut r = reader(&shared, 1000.0);
        // Below the target (40 frames at 1 kHz): silence, nothing taken.
        queue(&shared, (0..10).map(|i| [i as f32, -(i as f32)]));
        let mut out = [[9.0f32; 2]; 4];
        r.fill(&mut out);
        assert_eq!(out, [[0.0; 2]; 4]);
        assert_eq!(shared.queue.lock().unwrap().len(), 10);
        // At the target it plays, one frame behind (the first output is the silence before the first frame).
        queue(&shared, (10..40).map(|i| [i as f32, -(i as f32)]));
        let mut out = [[0.0f32; 2]; 5];
        r.fill(&mut out);
        let left: Vec<f32> = out.iter().map(|f| f[0].round()).collect();
        assert_eq!(left, vec![0.0, 0.0, 1.0, 2.0, 3.0]);
        assert_eq!(out[3][1].round(), -2.0);
    }

    #[test]
    fn goes_quiet_when_it_runs_dry_and_primes_again() {
        let shared = Arc::new(Shared::default());
        shared.in_rate.store(1000, Ordering::Relaxed);
        let mut r = reader(&shared, 1000.0);
        queue(&shared, (0..40).map(|_| [0.5f32, 0.5]));
        let mut out = [[0.0f32; 2]; 60];
        r.fill(&mut out);
        assert!(out[20][0] > 0.4);
        assert_eq!(out[59], [0.0, 0.0]);
        assert!(r.priming);
    }

    #[test]
    fn resamples_to_the_device_rate() {
        let shared = Arc::new(Shared::default());
        shared.in_rate.store(1000, Ordering::Relaxed);
        // The device runs twice as fast: each input frame lasts two output frames.
        let mut r = reader(&shared, 2000.0);
        queue(&shared, (0..200).map(|i| [i as f32, 0.0]));
        let mut out = [[0.0f32; 2]; 41];
        r.fill(&mut out);
        let taken = 200 - shared.queue.lock().unwrap().len();
        assert!(
            (20..=22).contains(&taken),
            "took {taken} frames for 41 at half the rate"
        );
        // Halfway between frames, the output is halfway between their values.
        assert!((out[3][0] - 0.5).abs() < 0.05, "{}", out[3][0]);
    }

    #[test]
    fn cuts_a_burst_back_to_its_target() {
        let shared = Arc::new(Shared::default());
        shared.in_rate.store(1000, Ordering::Relaxed);
        let mut r = reader(&shared, 1000.0);
        queue(&shared, (0..500).map(|_| [0.1f32, 0.1]));
        let mut out = [[0.0f32; 2]; 1];
        r.fill(&mut out);
        let left = shared.queue.lock().unwrap().len();
        assert!(left <= 40, "{left} frames left");
    }

    #[test]
    fn says_how_long_until_a_push_is_heard() {
        let audio = NativeAudio::default();
        // Started already, so the test opens no audio device.
        audio.shared.started.store(true, Ordering::SeqCst);
        let frames: Vec<u8> = (0..480)
            .flat_map(|_| [0.25f32.to_le_bytes(), 0.25f32.to_le_bytes()].concat())
            .collect();
        let behind = audio.push(&frames, 48_000);
        assert!((behind - 0.01).abs() < 1e-6, "{behind}");
        assert_eq!(audio.shared.queue.lock().unwrap().len(), 480);
    }
}
