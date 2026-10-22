@echo off
chcp 65001 >nul
title 停止 Python 教学平台
taskkill /F /IM CheckinApp.exe >nul 2>&1
if errorlevel 1 (
    echo 没有正在运行的教学平台实例。
) else (
    echo 已停止。数据保存在本目录的 data 文件夹里，不会丢。
)
timeout /t 3 >nul
exit /b 0
