; Installer hooks (bundle.windows.nsis.installerHooks in tauri.conf.json).

; Tauri registers .soundwave files with the app's own icon; song files get theirs
; (src-tauri/icons/soundwave-file.ico, made by tools/icon/build_file_icon.mjs). The class name
; is the file association's "name" in tauri.conf.json.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\Soundwave.Song\DefaultIcon" "" "$INSTDIR\soundwave-file.ico"
  ; Tell Explorer the associations changed and wait until it has taken them in, so the type name
  ; and icon show without signing out (UPDATEFILEASSOC is in Tauri's FileAssociation.nsh).
  !insertmacro UPDATEFILEASSOC
!macroend
