mod haptics;
mod song_files;
mod touchpad;

use std::time::Duration;
use tauri::Manager;

/// Quits the game: every window closes and the process ends.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // One game at a time: opening a song file while it runs hands the file to the running game
    // instead of starting another. Not in development builds, so a second dev build can run beside one.
    if !cfg!(debug_assertions) {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            song_files::open(
                app,
                song_files::song_files(argv, std::path::Path::new(&cwd)),
            );
            song_files::focus(app);
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(haptics::Haptics::default())
        .manage(touchpad::Touchpad::default())
        .manage(song_files::Opened::default())
        .manage(song_files::Saving::default())
        .invoke_handler(tauri::generate_handler![
            exit_app,
            haptics::haptics_available,
            haptics::haptics_play,
            haptics::haptics_update,
            haptics::haptics_release,
            touchpad::touchpad_watch,
            touchpad::touchpad_finger,
            song_files::take_opened_files,
            song_files::read_opened_file,
            song_files::save_file_begin,
            song_files::save_file_write,
            song_files::save_file_end
        ])
        .setup(|app| {
            // A song file double-clicked in Explorer starts the game with its path.
            let cwd = std::env::current_dir().unwrap_or_default();
            song_files::open(app.handle(), song_files::song_files(std::env::args(), &cwd));
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
