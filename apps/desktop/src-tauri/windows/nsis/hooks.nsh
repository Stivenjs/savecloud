; SaveCloud NSIS Installer Hooks
; Agrega fuentes verificadas solo cuando el catálogo trae fuentes nuevas.

!include "LogicLib.nsh"
!include "FileFunc.nsh"

; Captura la ruta de este hook antes de que Tauri expanda el cuerpo de la macro.
!define SAVE_CLOUD_NSIS_HOOK_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_POSTINSTALL
  ; Extraer los archivos solo al directorio temporal del instalador.
  Push $0
  Push $1
  Push $OUTDIR
  SetOutPath "$PLUGINSDIR"
  File /oname=installer-sources.ps1 "${SAVE_CLOUD_NSIS_HOOK_DIR}\..\..\resources\installer-sources.ps1"
  File /oname=verified_sources.json "${SAVE_CLOUD_NSIS_HOOK_DIR}\..\..\resources\verified_sources.json"
  Pop $1
  SetOutPath "$1"
  Pop $1
  Pop $0

  CreateDirectory "$APPDATA\SaveCloud\data\cache"

  ${IfNot} ${Silent}
    nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\installer-sources.ps1" -Action Check -DataRoot "$APPDATA\SaveCloud\data" -PresetPath "$PLUGINSDIR\verified_sources.json" -PendingPath "$PLUGINSDIR\verified-sources-pending.json"'
    Pop $0
    ${If} $0 == 10
      ${If} $LANGUAGE == ${LANG_SPANISHINTERNATIONAL}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Hay nuevas fuentes verificadas disponibles para SaveCloud.$\r$\n$\r$\n¿Quieres añadirlas a tu catálogo?" /SD IDNO IDYES apply_verified_sources IDNO dismiss_verified_sources
      ${Else}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "New verified sources are available for SaveCloud.$\r$\n$\r$\nWould you like to add them to your catalog?" /SD IDNO IDYES apply_verified_sources IDNO dismiss_verified_sources
      ${EndIf}

      apply_verified_sources:
      nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\installer-sources.ps1" -Action Apply -DataRoot "$APPDATA\SaveCloud\data" -PresetPath "$PLUGINSDIR\verified_sources.json" -PendingPath "$PLUGINSDIR\verified-sources-pending.json"'
      Pop $0
      ${If} $0 != 0
        ${If} $LANGUAGE == ${LANG_SPANISHINTERNATIONAL}
          MessageBox MB_OK|MB_ICONEXCLAMATION "No se pudieron añadir las nuevas fuentes. Puedes instalarlas luego desde Configuración."
        ${Else}
          MessageBox MB_OK|MB_ICONEXCLAMATION "The new sources could not be added. You can install them later from Settings."
        ${EndIf}
      ${EndIf}
      Goto verified_sources_done

      dismiss_verified_sources:
      nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\installer-sources.ps1" -Action Dismiss -DataRoot "$APPDATA\SaveCloud\data" -PresetPath "$PLUGINSDIR\verified_sources.json" -PendingPath "$PLUGINSDIR\verified-sources-pending.json"'
      Pop $0
    ${EndIf}
  ${EndIf}

verified_sources_done:
  ; Eliminar copias que dejaron versiones anteriores del instalador en resources.
  Delete "$INSTDIR\resources\installer-sources.ps1"
  Delete "$INSTDIR\resources\verified_sources.json"
!macroend
