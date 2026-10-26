; SaveCloud NSIS Installer Hooks
; Agrega fuentes verificadas solo cuando el catálogo trae fuentes nuevas.

!include "LogicLib.nsh"
!include "FileFunc.nsh"

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$APPDATA\SaveCloud\data\cache"

  ${IfNot} ${Silent}
    nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer-sources.ps1" -Action Check -DataRoot "$APPDATA\SaveCloud\data" -PresetPath "$INSTDIR\resources\verified_sources.json" -PendingPath "$PLUGINSDIR\verified-sources-pending.json"'
    Pop $0
    ${If} $0 == 10
      ${If} $LANGUAGE == ${LANG_SPANISHINTERNATIONAL}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Hay nuevas fuentes verificadas disponibles para SaveCloud.$\r$\n$\r$\n¿Quieres añadirlas a tu catálogo?" /SD IDNO IDYES apply_verified_sources IDNO dismiss_verified_sources
      ${Else}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "New verified sources are available for SaveCloud.$\r$\n$\r$\nWould you like to add them to your catalog?" /SD IDNO IDYES apply_verified_sources IDNO dismiss_verified_sources
      ${EndIf}

      apply_verified_sources:
      nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer-sources.ps1" -Action Apply -DataRoot "$APPDATA\SaveCloud\data" -PresetPath "$INSTDIR\resources\verified_sources.json" -PendingPath "$PLUGINSDIR\verified-sources-pending.json"'
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
      nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer-sources.ps1" -Action Dismiss -DataRoot "$APPDATA\SaveCloud\data" -PresetPath "$INSTDIR\resources\verified_sources.json" -PendingPath "$PLUGINSDIR\verified-sources-pending.json"'
      Pop $0
    ${EndIf}
  ${EndIf}

verified_sources_done:
!macroend
