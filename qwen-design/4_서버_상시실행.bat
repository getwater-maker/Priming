@echo off
rem ============================================================================
rem  Qwen3-TTS VoiceDesign server - always-on launcher (lazy load + idle unload)
rem
rem  * Server opens port 9893 immediately WITHOUT loading the model -> 0 VRAM.
rem  * Model loads on first request (/prepare or /design), takes ~20s.
rem  * After 600s idle the model is unloaded and VRAM is released; server stays up.
rem    -> Other PCs (wife's PC) can use it anytime, and the GPU is free when unused.
rem
rem  Auto start: Win+R -> shell:startup -> put a SHORTCUT of this file there.
rem              (no admin rights needed; runs at every logon)
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
rem     pythonw.exe is a GUI-subsystem app, so cmd does not wait for it: calling it
rem     directly returns immediately. Keep the redirection - pythonw has no console,
rem     so our server's print() needs a real handle or it can raise.
rem ============================================================================
cd /d "%~dp0"
if not exist "venv\Scripts\pythonw.exe" (
  echo [ERROR] venv not found. Run the install bat in this folder first.
  pause
  exit /b 1
)
"venv\Scripts\pythonw.exe" "qwen_design_server.py" --host 0.0.0.0 --port 9893 --idle-timeout 600 >> "server.log" 2>&1
echo VoiceDesign server started in background - port 9893, lazy load, idle unload 600s.
echo Log file: %~dp0server.log
exit /b 0
