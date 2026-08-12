@echo off
REM Double-click this to preview the site locally.
REM ES modules are blocked on file:// so game.html needs a real HTTP server.
REM Pure PowerShell - nothing to install.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1" %*
