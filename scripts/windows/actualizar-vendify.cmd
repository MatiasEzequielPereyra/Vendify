@echo off
setlocal
cd /d "%~dp0\..\.."
echo.
echo === Actualizando Vendify ===
git pull origin refactor/modular-runtime
if errorlevel 1 goto :error
echo.
echo Actualizacion completada.
pause
exit /b 0
:error
echo.
echo La actualizacion fallo. No ejecutes reset: copia este error y compartilo.
pause
exit /b 1
