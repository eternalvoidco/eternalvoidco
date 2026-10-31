@echo off
rem Double-click to build the ETERNAL VOID video. Extra arguments are passed through,
rem e.g.  Run-EternalVoid.bat -Logo "C:\path\EV emblem.png" -EnableScriptFileAccess
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-EternalVoid.ps1" %*
pause
