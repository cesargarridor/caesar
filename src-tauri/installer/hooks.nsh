; Barra de progreso del instalador con los colores de Caesar (fondo #130f30, barra #8052ff).
; Los colores van en formato BGR. Si algo falla (p. ej. instalación silenciosa sin ventana) no pasa nada.
!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1
  FindWindow $R0 "#32770" "" $HWNDPARENT
  IntCmp $R0 0 caesar_skip_bar caesar_skip_bar
  GetDlgItem $R1 $R0 1004
  IntCmp $R1 0 caesar_skip_bar caesar_skip_bar
  System::Call 'uxtheme::SetWindowTheme(i $R1, w " ", w " ")'
  SendMessage $R1 0x2001 0 0x300F13
  SendMessage $R1 0x409 0 0xFF5280
  caesar_skip_bar:
  Pop $R1
  Pop $R0
!macroend
