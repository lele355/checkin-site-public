@echo off
chcp 65001 >nul
title 备份教学数据
cd /d "%~dp0"

if not exist "data" (
    echo 还没有 data 目录，说明平台从未启动过，不需要备份。
    pause
    exit /b 0
)

if not exist "backup" mkdir "backup"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set "TS=%%i"
set "ZIP=backup\pylab-data-%TS%.zip"

echo 正在打包 data 目录到 %ZIP% ……
powershell -NoProfile -Command "Compress-Archive -Path 'data\*' -DestinationPath '%ZIP%' -Force"
if errorlevel 1 (
    echo [错误] 备份失败。请确认磁盘空间充足。
    pause
    exit /b 1
)

echo.
echo 备份完成：%ZIP%
echo 换电脑时，把整个文件夹拷走；或在关闭平台后把这个 zip 解压回 data 目录。
pause
exit /b 0
