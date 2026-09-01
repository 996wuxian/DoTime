Function un.TrimNewlines
  Exch $R0
  Push $R1

  loop:
    StrCpy $R1 $R0 1 -1
    StrCmp $R1 "$\r" trim
    StrCmp $R1 "$\n" trim done

  trim:
    StrCpy $R0 $R0 -1
    Goto loop

  done:
    Pop $R1
    Exch $R0
FunctionEnd

Function un.DeleteConfiguredDataDirectory
  Exch $R0
  Push $R1
  Push $R2

  StrCmp $R0 "" done
  StrCmp $R0 "$APPDATA" done
  StrCmp $R0 "$LOCALAPPDATA" done
  StrCmp $R0 "$APPDATA\${BUNDLEID}" done
  StrCmp $R0 "$LOCALAPPDATA\${BUNDLEID}" done

  ; Avoid deleting drive roots such as D:\ if a bad marker file exists.
  StrCpy $R2 $R0 1 1
  StrCmp $R2 ":" 0 check_exists
  StrLen $R1 $R0
  IntCmp $R1 3 done done check_exists

  check_exists:
    IfFileExists "$R0\*.*" 0 done
    RmDir /r "$R0"

  done:
    Pop $R2
    Pop $R1
    Pop $R0
FunctionEnd

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    ClearErrors
    FileOpen $R0 "$APPDATA\${BUNDLEID}\data-directory.txt" r
    ${IfNot} ${Errors}
      FileRead $R0 $R1
      FileClose $R0
      Push $R1
      Call un.TrimNewlines
      Pop $R1
      Push $R1
      Call un.DeleteConfiguredDataDirectory
    ${EndIf}
  ${EndIf}
!macroend
