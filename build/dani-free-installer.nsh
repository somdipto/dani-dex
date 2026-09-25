; Installer introduction uses the product name, not the name of its underlying engine.
; An assisted welcome page makes the bundled Dani Free component visible before installation.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Install Dani-Dex"
  !define MUI_WELCOMEPAGE_TEXT "Dani Free is included with Dani-Dex.$\r$\n$\r$\nChoose Next to install Dani-Dex."
  !insertmacro MUI_PAGE_WELCOME
!macroend
