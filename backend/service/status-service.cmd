@echo off
setlocal EnableExtensions
sc.exe query "NuqtaPlusBackend"
exit /b %errorlevel%
