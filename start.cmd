@echo off
chcp 65001 >nul
rem Локальный запуск ландшафта одним действием: двойной клик в Проводнике
rem или start.cmd в терминале. Windows-эквивалент start.command.
rem
rem Поднимает scripts\serve.py (сайт + редактор с записью в app\data.js)
rem и открывает редактор в браузере. «Собрать dist» — кнопка в самом редакторе.
rem Остановить сервер: Ctrl+C в этом окне.
cd /d "%~dp0"

set "URL=http://127.0.0.1:8123/editor.html"

rem Сервер уже запущен? Тогда просто открываем вкладку.
netstat -ano | findstr ":8123" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo Сервер уже запущен — открываю %URL%
    start "" "%URL%"
    exit /b 0
)

rem Браузер откроется через пару секунд, когда сервер поднимется.
start "" /min powershell -NoProfile -Command "Start-Sleep 2; Start-Process '%URL%'"

rem Python: сначала py-лаунчер, потом python из PATH.
where py >nul 2>&1
if not errorlevel 1 (
    py -3 scripts\serve.py
) else (
    python scripts\serve.py
)
