//! PS5 DualSense haptics. Connected by USB, the controller is also a 4-channel audio output whose
//! channels 3 and 4 drive the left and right voice-coil actuators. Playing short tuned waveforms
//! there gives positional, textured feedback. Done natively so the web view never has to ask for
//! media permission just to find the device.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Deserialize;

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Click,
    Thud,
    Buzz,
    Sweep,
}

#[derive(Deserialize)]
pub struct Effect {
    /// -1 = left actuator, 1 = right.
    pan: f32,
    /// 0..1, 1 = full scale.
    amp: f32,
    ms: f32,
    kind: Kind,
    /// Held effects (buzz) play until released with this id.
    hold: Option<u32>,
}

struct Voice {
    kind: Kind,
    gain_l: f32,
    gain_r: f32,
    amp: f32,
    dur: f32,
    t: f32,
    phase: f32,
    hold: Option<u32>,
    released_at: Option<f32>,
}

impl Voice {
    fn new(e: &Effect) -> Self {
        // Constant-power pan between the two actuators.
        let a = (e.pan.clamp(-1.0, 1.0) + 1.0) * 0.25 * std::f32::consts::PI;
        Voice {
            kind: e.kind,
            gain_l: a.cos(),
            gain_r: a.sin(),
            amp: e.amp.clamp(0.0, 1.0),
            dur: (e.ms / 1000.0).max(0.01),
            t: 0.0,
            phase: 0.0,
            hold: e.hold,
            released_at: None,
        }
    }

    fn done(&self) -> bool {
        match self.kind {
            Kind::Buzz => self.released_at.is_some_and(|r| self.t > r + 0.05),
            _ => self.t > self.dur,
        }
    }

    /// Next sample at 1/sr seconds per call.
    fn next(&mut self, dt: f32) -> f32 {
        let t = self.t;
        let p = (t / self.dur).min(1.0);
        // Full strength for the first part, then down to -60 dB by the effect's end.
        let hold_then_decay = |hold: f32| if p < hold { 1.0 } else { (-6.9 * (p - hold) / (1.0 - hold)).exp() };
        let (freq, env) = match self.kind {
            Kind::Click => (185.0, (t / 0.003).min(1.0) * hold_then_decay(0.4)),
            Kind::Thud => (90.0 * (0.5f32).powf(p), hold_then_decay(0.3)),
            Kind::Sweep => (60.0 * (4.4f32).powf(p), if p < 0.3 { p / 0.3 } else { (-6.9 * (p - 0.3) / 0.7).exp() }),
            Kind::Buzz => {
                let attack = (t / 0.03).min(1.0);
                let release = self.released_at.map_or(1.0, |r| (1.0 - (t - r) / 0.05).max(0.0));
                (150.0, 0.75 * attack * release)
            }
        };
        self.phase = (self.phase + freq * dt) % 1.0;
        self.t += dt;
        // A softly clipped sine: more energy into the actuator than a pure sine at the same peak.
        let s = (2.2 * (self.phase * std::f32::consts::TAU).sin()).tanh() / 2.2f32.tanh();
        s * env * self.amp
    }
}

#[derive(Default)]
pub struct Haptics {
    voices: Arc<Mutex<Vec<Voice>>>,
    connected: Arc<AtomicBool>,
    started: AtomicBool,
}

fn is_dualsense(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("dualsense") || n.contains("wireless controller")
}

/// Opens the DualSense output, if one is connected by USB.
fn open(voices: &Arc<Mutex<Vec<Voice>>>, failed: &Arc<AtomicBool>) -> Option<cpal::Stream> {
    let host = cpal::default_host();
    let device = host.output_devices().ok()?.find(|d| {
        #[allow(deprecated)]
        let name = d.name().unwrap_or_default();
        is_dualsense(&name) && d.supported_output_configs().map(|mut c| c.any(|c| c.channels() >= 4)).unwrap_or(false)
    })?;
    let range = device
        .supported_output_configs()
        .ok()?
        .filter(|c| c.channels() >= 4 && c.sample_format() == cpal::SampleFormat::F32)
        .max_by_key(|c| c.channels() == 4)?;
    let rate = cpal::SampleRate(48_000).clamp(range.min_sample_rate(), range.max_sample_rate());
    let config: cpal::StreamConfig = range.with_sample_rate(rate).into();
    let channels = config.channels as usize;
    let dt = 1.0 / rate.0 as f32;
    let voices = voices.clone();
    let failed_cb = failed.clone();
    let stream = device
        .build_output_stream(
            &config,
            move |data: &mut [f32], _| {
                data.fill(0.0);
                let Ok(mut v) = voices.lock() else { return };
                if v.is_empty() {
                    return;
                }
                for frame in data.chunks_mut(channels) {
                    let (mut l, mut r) = (0.0f32, 0.0f32);
                    for voice in v.iter_mut() {
                        let s = voice.next(dt);
                        l += s * voice.gain_l;
                        r += s * voice.gain_r;
                    }
                    frame[2] = l.clamp(-1.0, 1.0);
                    frame[3] = r.clamp(-1.0, 1.0);
                }
                v.retain(|x| !x.done());
            },
            move |_| failed_cb.store(true, Ordering::SeqCst),
            None,
        )
        .ok()?;
    stream.play().ok()?;
    Some(stream)
}

impl Haptics {
    /// Starts watching for a DualSense (once, in the background).
    fn start(&self) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let voices = self.voices.clone();
        let connected = self.connected.clone();
        // The stream lives on its own thread: audio streams can't move between threads.
        thread::spawn(move || {
            let failed = Arc::new(AtomicBool::new(false));
            let mut stream: Option<cpal::Stream> = None;
            loop {
                if failed.swap(false, Ordering::SeqCst) {
                    stream = None;
                }
                if stream.is_none() {
                    stream = open(&voices, &failed);
                    if stream.is_none() {
                        if let Ok(mut v) = voices.lock() {
                            v.clear();
                        }
                    }
                }
                connected.store(stream.is_some(), Ordering::SeqCst);
                thread::sleep(Duration::from_secs(if stream.is_some() { 1 } else { 3 }));
            }
        });
    }
}

/// Whether a USB DualSense is ready. Async so the first device search never blocks the window.
#[tauri::command]
pub async fn haptics_available(state: tauri::State<'_, Haptics>) -> Result<bool, String> {
    state.start();
    for _ in 0..20 {
        if state.connected.load(Ordering::SeqCst) {
            return Ok(true);
        }
        short_wait().await;
    }
    Ok(state.connected.load(Ordering::SeqCst))
}

async fn short_wait() {
    tauri::async_runtime::spawn_blocking(|| thread::sleep(Duration::from_millis(50))).await.ok();
}

#[tauri::command]
pub fn haptics_play(state: tauri::State<'_, Haptics>, effect: Effect) {
    state.start();
    if !state.connected.load(Ordering::SeqCst) {
        return;
    }
    if let Ok(mut v) = state.voices.lock() {
        if let Some(id) = effect.hold {
            v.retain(|x| x.hold != Some(id));
        }
        v.push(Voice::new(&effect));
    }
}

#[tauri::command]
pub fn haptics_release(state: tauri::State<'_, Haptics>, id: u32) {
    if let Ok(mut v) = state.voices.lock() {
        for x in v.iter_mut().filter(|x| x.hold == Some(id) && x.released_at.is_none()) {
            x.released_at = Some(x.t);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(v: &mut Voice, secs: f32) -> Vec<f32> {
        (0..(secs * 48_000.0) as usize).map(|_| v.next(1.0 / 48_000.0)).collect()
    }

    fn effect(kind: Kind, ms: f32, pan: f32) -> Effect {
        Effect { pan, amp: 1.0, ms, kind, hold: None }
    }

    #[test]
    fn click_is_strong_then_gone() {
        let mut v = Voice::new(&effect(Kind::Click, 55.0, 0.0));
        let s = render(&mut v, 0.06);
        let peak = s.iter().take(2400).fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(peak > 0.9, "full-scale at strong: {peak}");
        assert!(s[2700..].iter().all(|x| x.abs() < 0.01));
        assert!(v.done());
    }

    #[test]
    fn pan_moves_between_actuators() {
        let left = Voice::new(&effect(Kind::Click, 50.0, -1.0));
        let right = Voice::new(&effect(Kind::Click, 50.0, 1.0));
        assert!(left.gain_l > 0.99 && left.gain_r < 0.01);
        assert!(right.gain_r > 0.99 && right.gain_l < 0.01);
    }

    #[test]
    fn buzz_holds_until_released() {
        let mut v = Voice::new(&Effect { pan: 0.0, amp: 1.0, ms: 0.0, kind: Kind::Buzz, hold: Some(1) });
        render(&mut v, 0.5);
        assert!(!v.done());
        v.released_at = Some(v.t);
        render(&mut v, 0.1);
        assert!(v.done());
    }

    #[test]
    fn finds_the_controller_by_name() {
        assert!(is_dualsense("Speakers (DualSense Wireless Controller)"));
        assert!(is_dualsense("Lautsprecher (Wireless Controller)"));
        assert!(!is_dualsense("Speakers (Realtek(R) Audio)"));
    }
}
