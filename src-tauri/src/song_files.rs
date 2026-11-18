//! .festival song files on disk: the ones the system opens the app with (double-clicked in
//! Explorer, or passed on by a second launch), and saving a song's file where the player chooses.
//!
//! The page only ever reads the files listed here, by the number given to each, so it cannot ask
//! for any other file on the computer.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const EXT: &str = "festival";
/// The event that tells the page there are opened files to take.
const OPENED: &str = "festival://opened";

#[derive(Default)]
pub struct Opened {
  inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
  next: u32,
  /// Opened and not yet listed to the page.
  waiting: Vec<PathBuf>,
  /// Listed to the page and not yet read, by the number the page asks for.
  listed: HashMap<u32, PathBuf>,
}

#[derive(Serialize)]
pub struct OpenedFile {
  id: u32,
  name: String,
}

/// The song files among a command line (the program's own path first, as in `std::env::args`).
pub fn song_files(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<PathBuf> {
  args
    .into_iter()
    .skip(1)
    .map(PathBuf::from)
    .map(|p| if p.is_absolute() { p } else { cwd.join(p) })
    .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(EXT)) && p.is_file())
    .collect()
}

/// Queues files the app was asked to open and tells the page.
pub fn open(app: &AppHandle, files: Vec<PathBuf>) {
  if files.is_empty() {
    return;
  }
  app.state::<Opened>().inner.lock().unwrap().waiting.extend(files);
  let _ = app.emit(OPENED, ());
}

/// Brings the window to the front, for a file opened while the app runs.
pub fn focus(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

/// The files waiting to be read, each with the number to read it by.
#[tauri::command]
pub fn take_opened_files(state: State<Opened>) -> Vec<OpenedFile> {
  let mut inner = state.inner.lock().unwrap();
  let waiting = std::mem::take(&mut inner.waiting);
  waiting
    .into_iter()
    .map(|path| {
      inner.next += 1;
      let id = inner.next;
      let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| format!("song.{EXT}"));
      inner.listed.insert(id, path);
      OpenedFile { id, name }
    })
    .collect()
}

/// The bytes of a file listed by `take_opened_files`. Each can be read once.
#[tauri::command]
pub fn read_opened_file(state: State<Opened>, id: u32) -> Result<Response, String> {
  let path = state.inner.lock().unwrap().listed.remove(&id).ok_or("that file was not opened")?;
  std::fs::read(&path).map(Response::new).map_err(|e| format!("could not read {}: {e}", path.display()))
}

fn percent_decode(s: &str) -> String {
  let bytes = s.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%' && i + 2 < bytes.len() {
      let hex = |b: u8| (b as char).to_digit(16);
      if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
        out.push((hi * 16 + lo) as u8);
        i += 3;
        continue;
      }
    }
    out.push(bytes[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).into_owned()
}

/// Asks where to save a song file (the request body; its suggested name in `x-file-name`) and
/// writes it there. The path it was saved to, or none when the player cancelled.
#[tauri::command]
pub async fn save_song_file(app: AppHandle, window: WebviewWindow, request: Request<'_>) -> Result<Option<String>, String> {
  let InvokeBody::Raw(bytes) = request.body() else {
    return Err("no song file was sent".into());
  };
  let name = request
    .headers()
    .get("x-file-name")
    .and_then(|v| v.to_str().ok())
    .map(percent_decode)
    .unwrap_or_else(|| format!("song.{EXT}"));
  let Some(chosen) = app
    .dialog()
    .file()
    .set_parent(&window)
    .set_title("Export song")
    .set_file_name(&name)
    .add_filter("Festival song", &[EXT])
    .blocking_save_file()
  else {
    return Ok(None);
  };
  let mut path = chosen.into_path().map_err(|e| e.to_string())?;
  if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case(EXT)) {
    let mut s = path.into_os_string();
    s.push(format!(".{EXT}"));
    path = s.into();
  }
  std::fs::write(&path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
  Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn decodes_percent_escapes() {
    assert_eq!(percent_decode("AC%2FDC%20-%20T.N.T.festival"), "AC/DC - T.N.T.festival");
    assert_eq!(percent_decode("B%C3%BCcher.festival"), "Bücher.festival");
    assert_eq!(percent_decode("100%"), "100%");
  }

  #[test]
  fn finds_song_files_on_a_command_line() {
    let dir = std::env::temp_dir().join("festival-song-files-test");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("a.festival"), b"x").unwrap();
    std::fs::write(dir.join("b.FESTIVAL"), b"x").unwrap();
    std::fs::write(dir.join("c.mp3"), b"x").unwrap();
    let args = ["festival.exe", "a.festival", "b.FESTIVAL", "c.mp3", "missing.festival", "--flag"].map(String::from);
    let found = song_files(args, &dir);
    assert_eq!(found, vec![dir.join("a.festival"), dir.join("b.FESTIVAL")]);
  }
}
