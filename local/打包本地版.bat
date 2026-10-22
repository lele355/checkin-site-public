@echo off
chcp 65001 >nul
title 打包 Python 教学平台（本地版）
cd /d "%~dp0"

set "OUT=%~1"
if "%OUT%"=="" set "OUT=D:\checkin-local"
set "SRC=%~dp0..\CheckinApp\CheckinApp.csproj"

echo.
echo  源项目：%SRC%
echo  输出到：%OUT%
echo.

dotnet publish "%SRC%" -c Release -r win-x64 --self-contained true -o "%OUT%" --nologo
if errorlevel 1 (
    echo.
    echo [错误] 发布失败，请看上面的编译输出。
    pause
    exit /b 1
)

rem ---- 清掉不该分发给别人的东西 ----
rem appsettings.Local.json 里有 AI Key 和本机 Python 路径，会随 publish 一起打包
del /q "%OUT%\appsettings.Local.json" 2>nul
rem 开发时的数据库与保护密钥，绝不能带到新机器
if exist "%OUT%\data" rmdir /s /q "%OUT%\data"
rem 开发环境配置也不需要
del /q "%OUT%\appsettings.Development.json" 2>nul

rem ---- 启动器与说明 ----
copy /y "启动.bat"       "%OUT%\" >nul
copy /y "停止.bat"       "%OUT%\" >nul
copy /y "备份数据.bat"   "%OUT%\" >nul
copy /y "使用说明.txt"   "%OUT%\" >nul

echo.
echo 打包完成：%OUT%
echo 把整个文件夹拷到目标电脑，双击「启动.bat」即可。
pause
exit /b 0
