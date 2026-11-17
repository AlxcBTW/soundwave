//! The touchpad of a PS5 controller, read natively. The web view's Gamepad API reports the pad's
//! click but not where a finger rests on it, so the on-screen keyboard's cursor gets the finger
//! from here: the controller's own input reports, read over HID while the keyboard is open.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;

const SONY: u16 = 0x054C;
/// DualSense and DualSense Edge.
const CONTROLLERS: [u16; 2] = [0x0CE6, 0x0DF2];
/// The touchpad's resolution.
const WIDTH: f32 = 1920.0;
const HEIGHT: f32 = 1080.0;

/// A finger on the touchpad: -1..1 across it and down it.
#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
pub struct Finger {
    x: f32,
    y: f32,
}

#[derive(Default)]
pub struct Touchpad {
    finger: Arc<Mutex<Option<Finger>>>,
    wanted: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
}

/// The first finger in an input report: `None` for a report that carries no touchpad data,
/// `Some(None)` for one that says no finger is down.
///
/// By USB the controller sends report 0x01 (64 bytes) with the first touch point at byte 33; by
/// Bluetooth it sends report 0x31, where everything sits one byte later. A touch point is four
/// bytes: a flag (top bit set = not touching) and id, then x and y as 12 bits each.
pub fn parse(report: &[u8]) -> Option<Option<Finger>> {
    let at = match *report.first()? {
        0x01 if report.len() >= 37 => 33,
        0x31 if report.len() >= 38 => 34,
        _ => return None,
    };
    let p = &report[at..at + 4];
    if p[0] & 0x80 != 0 {
        return Some(None);
    }
    let x = (((p[2] & 0x0F) as u16) << 8) | p[1] as u16;
    let y = ((p[3] as u16) << 4) | (p[2] >> 4) as u16;
    Some(Some(Finger {
        x: (x as f32 / (WIDTH - 1.0)).clamp(0.0, 1.0) * 2.0 - 1.0,
        y: (y as f32 / (HEIGHT - 1.0)).clamp(0.0, 1.0) * 2.0 - 1.0,
    }))
}

fn open(api: &hidapi::HidApi) -> Option<hidapi::HidDevice> {
    let device = api
        .device_list()
        .filter(|d| d.vendor_id() == SONY && CONTROLLERS.contains(&d.product_id()))
        .find_map(|d| d.open_device(api).ok())?;
    // By Bluetooth the controller sends only a short report until its calibration is read once.
    let mut calibration = [0u8; 41];
    calibration[0] = 0x05;
    let _ = device.get_feature_report(&mut calibration);
    Some(device)
}

impl Touchpad {
    /// Starts following the touchpad (until `wanted` is cleared). Safe to call again and again.
    fn start(&self) {
        self.wanted.store(true, Ordering::SeqCst);
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let finger = self.finger.clone();
        let wanted = self.wanted.clone();
        let running = self.running.clone();
        thread::spawn(move || {
            let set = |f: Option<Finger>| {
                if let Ok(mut slot) = finger.lock() {
                    *slot = f;
                }
            };
            if let Ok(mut api) = hidapi::HidApi::new() {
                let mut report = [0u8; 128];
                while wanted.load(Ordering::SeqCst) {
                    let Some(device) = open(&api) else {
                        // No controller yet: look again in a moment.
                        set(None);
                        thread::sleep(Duration::from_millis(800));
                        let _ = api.refresh_devices();
                        continue;
                    };
                    while wanted.load(Ordering::SeqCst) {
                        match device.read_timeout(&mut report, 100) {
                            Ok(0) => {}
                            Ok(n) => {
                                if let Some(f) = parse(&report[..n]) {
                                    set(f);
                                }
                            }
                            // Unplugged or switched off: go back to looking for one.
                            Err(_) => break,
                        }
                    }
                    set(None);
                }
            }
            set(None);
            running.store(false, Ordering::SeqCst);
        });
    }
}

/// Follows the touchpad while the on-screen keyboard is open, and lets go of it afterwards.
#[tauri::command]
pub fn touchpad_watch(state: tauri::State<'_, Touchpad>, on: bool) {
    if on {
        state.start();
    } else {
        state.wanted.store(false, Ordering::SeqCst);
    }
}

/// Where the finger is right now, if one is on the pad.
#[tauri::command]
pub fn touchpad_finger(state: tauri::State<'_, Touchpad>) -> Option<Finger> {
    state.finger.lock().ok().and_then(|f| *f)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usb(point: [u8; 4]) -> Vec<u8> {
        let mut r = vec![0u8; 64];
        r[0] = 0x01;
        r[33..37].copy_from_slice(&point);
        r
    }

    #[test]
    fn reads_no_finger() {
        assert_eq!(parse(&usb([0x80, 0, 0, 0])), Some(None));
    }

    #[test]
    fn reads_the_corners_and_the_middle() {
        // x = 0, y = 0: top left.
        assert_eq!(parse(&usb([0x01, 0x00, 0x00, 0x00])), Some(Some(Finger { x: -1.0, y: -1.0 })));
        // x = 1919 (0x77F), y = 1079 (0x437): bottom right.
        assert_eq!(parse(&usb([0x01, 0x7F, 0x77, 0x43])), Some(Some(Finger { x: 1.0, y: 1.0 })));
        // x = 960 (0x3C0), y = 540 (0x21C): the middle, near enough.
        let mid = parse(&usb([0x01, 0xC0, 0xC3, 0x21])).unwrap().unwrap();
        assert!(mid.x.abs() < 0.01 && mid.y.abs() < 0.01);
    }

    #[test]
    fn reads_bluetooth_reports_one_byte_later() {
        let mut r = vec![0u8; 78];
        r[0] = 0x31;
        r[34..38].copy_from_slice(&[0x01, 0x7F, 0x77, 0x43]);
        assert_eq!(parse(&r), Some(Some(Finger { x: 1.0, y: 1.0 })));
    }

    #[test]
    fn ignores_reports_without_touch_data() {
        // The short report a controller sends by Bluetooth before it is asked for the full one.
        assert_eq!(parse(&[0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0]), None);
        assert_eq!(parse(&[]), None);
    }

    /// Looks for a connected controller and prints what it sends. Run by hand:
    /// `cargo test touchpad::tests::hardware -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn hardware() {
        let api = hidapi::HidApi::new().expect("hid");
        for d in api.device_list().filter(|d| d.vendor_id() == SONY) {
            println!("sony device: product {:04x}, usage page {:04x}, usage {:04x}, interface {}", d.product_id(), d.usage_page(), d.usage(), d.interface_number());
        }
        let Some(device) = open(&api) else {
            println!("no DualSense found");
            return;
        };
        let mut report = [0u8; 128];
        for _ in 0..5 {
            match device.read_timeout(&mut report, 500) {
                Ok(n) => println!("report id {:02x}, {} bytes, touch bytes {:02x?} -> {:?}", report[0], n, &report[33..38], parse(&report[..n])),
                Err(e) => println!("read failed: {e}"),
            }
        }
    }
}
