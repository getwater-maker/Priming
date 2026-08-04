@echo off
rem ============================================================================
rem  Qwen3-TTS VoiceDesign server - always-on launcher (lazy load + idle unload)
rem
rem  * Server opens port 9893 immediately WITHOUT loading the model -> 0 VRAM.
rem  * Model loads on first request (/prepare or /design), takes ~20s.
rem  * After 600s idle the model is unloaded and VRAM is released; server stays up.
rem    -> Other PCs (wife's PC) can use it anytime, and the GPU is free when unused.
rem
rem  THIS FILE IS FOR MANUAL START ONLY.
rem  Auto start at logon does NOT use this bat any more - the Startup shortcut
rem  points straight at venv\Scripts\pythonw.exe (see below). Reason: cmd.exe
rem  WAITS for its child no matter the subsystem, so launching the server through
rem  a bat left a black console window on screen for as long as the server lived.
rem  (actually happened 2026-08-05 - the "VoiceDesign server" window at boot)
rem
rem  Startup shortcut (Win+R -> shell:startup) must be:
rem    Target : D:\Priming\qwen-design\venv\Scripts\pythonw.exe
rem    Args   : qwen_design_server.py --host 0.0.0.0 --port 9893 --idle-timeout 600
rem    Start in: D:\Priming\qwen-design
rem  pythonw.exe has no console at all -> nothing shows up on screen.
rem
rem  Logging: the server writes server.log BY ITSELF (see _log() in the py file),
rem  so no shell redirection is needed here. Do not add `>> server.log` back -
rem  see the `start` warning below.
rem
rem  Firewall: inbound TCP 9893 must be allowed (already added).
rem
rem  !! ASCII ONLY IN THIS FILE !!
rem     cmd.exe reads .bat in the system ANSI codepage (CP949 on Korean Windows).
rem     Korean text saved as UTF-8 gets mangled, lines break apart, and cmd ended up
rem     running a fragment like "rver.log" as a command -> Windows popped the
rem     "choose an app to open this .log file" dialog. (actually happened 2026-07-31)
rem
rem  !! DO NOT USE `start` HERE !!
rem     `start ... >> server.log` makes cmd pass server.log as the file to launch,
rem     which also triggers the same .log "open with" dialog.
rem ============================================================================
cd /d "%~dp0"
if not exist "venv\Scripts\pythonw.exe" (
  echo [ERROR] venv not found. Run the install bat in this folder first.
  pause
  exit /b 1
)
"venv\Scripts\pythonw.exe" "qwen_design_server.py" --host 0.0.0.0 --port 9893 --idle-timeout 600
echo VoiceDesign server stopped.
echo Log file: %~dp0server.log
exit /b 0
