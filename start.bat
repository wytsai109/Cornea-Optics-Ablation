@echo off
title Cornea-Optics Ablation Simulator

echo ==========================================================
echo   CORNEA-OPTICS ABLATION SIMULATOR
echo ==========================================================
echo.
echo Starting local web server on port 8080...

if exist "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" (
    start "" "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" "http://localhost:8080/"
) else (
    start http://localhost:8080/
)

python -m http.server 8080

pause
