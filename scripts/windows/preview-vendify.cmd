@echo off
setlocal
cd /d "%~dp0\..\.."
echo.
echo === Iniciando preview modular ===
echo Deja esta ventana abierta mientras probas la aplicacion.
call npm run preview:refactor:modular
pause
