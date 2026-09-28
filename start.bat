@echo off
:loop
cls
echo [ZeroTheLegend] Server in esecuzione...
node server
echo.
echo [ZeroTheLegend] Server arrestato. Riavvio automatico tra 2 secondi...
timeout /t 2 /nobreak >nul
goto loop