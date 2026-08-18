; SaveCloud NSIS Installer Hooks
; Agrega la opción de instalar fuentes de descargas verificadas en el instalador

!include "LogicLib.nsh"
!include "FileFunc.nsh"

; Cadenas multi-idioma con fallbacks seguros (Español e Inglés)
LangString MSG_INSTALL_SOURCES 0 "¿Deseas instalar las fuentes de descargas verificadas por SaveCloud?$\r$\n$\r$\nIncluye: FitGirl, SteamRip, DODI, GOG, OnlineFix, Xatab, Kazumi, SteamGG, RexaGames, 0xEMPRESS y AtopGames."
LangString MSG_INSTALL_SOURCES ${LANG_SPANISH} "¿Deseas instalar las fuentes de descargas verificadas por SaveCloud?$\r$\n$\r$\nIncluye: FitGirl, SteamRip, DODI, GOG, OnlineFix, Xatab, Kazumi, SteamGG, RexaGames, 0xEMPRESS y AtopGames."
LangString MSG_INSTALL_SOURCES ${LANG_SPANISHINTERNATIONAL} "¿Deseas instalar las fuentes de descargas verificadas por SaveCloud?$\r$\n$\r$\nIncluye: FitGirl, SteamRip, DODI, GOG, OnlineFix, Xatab, Kazumi, SteamGG, RexaGames, 0xEMPRESS y AtopGames."
LangString MSG_INSTALL_SOURCES ${LANG_ENGLISH} "Do you want to install verified download sources for SaveCloud?$\r$\n$\r$\nIncludes: FitGirl, SteamRip, DODI, GOG, OnlineFix, Xatab, Kazumi, SteamGG, RexaGames, 0xEMPRESS, and AtopGames."

LangString TITLE_INSTALL_SOURCES 0 "Fuentes Verificadas de SaveCloud"
LangString TITLE_INSTALL_SOURCES ${LANG_SPANISH} "Fuentes Verificadas de SaveCloud"
LangString TITLE_INSTALL_SOURCES ${LANG_SPANISHINTERNATIONAL} "Fuentes Verificadas de SaveCloud"
LangString TITLE_INSTALL_SOURCES ${LANG_ENGLISH} "SaveCloud Verified Sources"

!macro NSIS_HOOK_POSTINSTALL
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "$(MSG_INSTALL_SOURCES)" /SD IDYES IDNO skip_verified_sources
  ${EndIf}

  CreateDirectory "$APPDATA\SaveCloud\data\cache"

  ${If} ${FileExists} "$INSTDIR\resources\verified_sources.json"
    ${IfNot} ${FileExists} "$APPDATA\SaveCloud\data\cache\remote_sources.json"
      CopyFiles /SILENT "$INSTDIR\resources\verified_sources.json" "$APPDATA\SaveCloud\data\cache\remote_sources.json"
    ${Else}
      CopyFiles /SILENT "$INSTDIR\resources\verified_sources.json" "$APPDATA\SaveCloud\data\cache\verified_sources.json"
    ${EndIf}
  ${EndIf}

skip_verified_sources:
!macroend
