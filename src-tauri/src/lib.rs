mod haptics;

use std::time::Duration;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(haptics::Haptics::default())
    .invoke_handler(tauri::generate_handler![haptics::haptics_available, haptics::haptics_play, haptics::haptics_update, haptics::haptics_release])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // The window starts hidden and the page shows it once it is in the stored display mode
      // (src/game/displayMode.ts). Should the page never get that far, show the window anyway.
      let handle = app.handle().clone();
      std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        if let Some(window) = handle.get_webview_window("main") {
          if !window.is_visible().unwrap_or(true) {
            let _ = window.show();
          }
        }
      });
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
