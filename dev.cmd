@echo off
REM Run backend + frontend together. Usage: dev   |   dev -Seed   |   dev -Install
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
