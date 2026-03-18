@echo off
setlocal
title Seguimiento Aulas - Detener servicios

set "REPO_WIN=%~dp0"
if "%REPO_WIN:~-1%"=="\" set "REPO_WIN=%REPO_WIN:~0,-1%"

where wsl.exe >nul 2>&1
if errorlevel 1 (
  echo No se encontro WSL en este equipo.
  echo Instala WSL o ejecuta el proyecto desde la terminal Linux.
  echo.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%I in (`wsl.exe wslpath -a "%REPO_WIN%"`) do set "REPO=%%I"
if not defined REPO (
  echo No fue posible convertir la ruta del proyecto a formato WSL.
  echo Carpeta detectada: %REPO_WIN%
  echo.
  pause
  exit /b 1
)

echo Deteniendo servicios del proyecto...
echo Carpeta: %REPO_WIN%
echo.
wsl.exe bash -lc "cd \"%REPO%\" && bash scripts/dev-stack.sh down"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo La detencion termino con codigo %EXIT_CODE%.
) else (
  echo Servicios detenidos.
)
pause
exit /b %EXIT_CODE%
