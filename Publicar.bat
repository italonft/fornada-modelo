@echo off
setlocal
title Fornada - publicar
cd /d "%~dp0"

if not exist "%~dp0scripts\publicar.mjs" (
  echo Extraia a pasta da Fornada do arquivo zip antes de abrir este arquivo.
  pause
  exit /b 1
)

set "NODE_EXE="
if exist "%~dp0runtime\node\node.exe" set "NODE_EXE=%~dp0runtime\node\node.exe"
if not defined NODE_EXE (
  where node >nul 2>nul
  if not errorlevel 1 (
    node -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)" >nul 2>nul
    if not errorlevel 1 set "NODE_EXE=node"
  )
)

if not defined NODE_EXE (
  echo Preparando pela primeira vez: baixando o Node.js do site oficial nodejs.org.
  echo Isso acontece so uma vez e ocupa cerca de 100 MB dentro desta pasta.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\baixar-node.ps1"
  if errorlevel 1 (
    echo.
    echo Nao consegui baixar o Node.js automaticamente.
    echo Instale a versao LTS em https://nodejs.org e abra este arquivo de novo.
    pause
    exit /b 1
  )
  set "NODE_EXE=%~dp0runtime\node\node.exe"
)
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"

echo.
"%NODE_EXE%" "%~dp0scripts\publicar.mjs"
echo.
pause
