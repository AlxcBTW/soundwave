; Installer hooks (bundle.windows.nsis.installerHooks in tauri.conf.json).

; Tauri registers .festival files with the app's own icon; song files get theirs
; (src-tauri/icons/festival-file.ico, made by tools/icon/build_file_icon.mjs). The class name
; is the file association's "name" in tauri.conf.json.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\Festival.Song\DefaultIcon" "" "$INSTDIR\festival-file.ico"
  ; Tell Explorer the associations changed, so the new icon shows without a restart.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
