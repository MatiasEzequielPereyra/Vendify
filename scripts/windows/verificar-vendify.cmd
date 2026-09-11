@echo off
setlocal
cd /d "%~dp0\..\.."
echo.
echo === Verificando Vendify ===
call npm run typecheck || goto :error
call npm run lint || goto :error
call npm test || goto :error
call npm run build || goto :error
call node scripts\build-refactor-modular.mjs || goto :error
call npm run verify:refactor:modular || goto :error
echo.
echo Todas las verificaciones finalizaron correctamente.
pause
exit /b 0
:error
echo.
echo Una verificacion fallo. Copia todo este resultado y compartilo.
pause
exit /b 1
