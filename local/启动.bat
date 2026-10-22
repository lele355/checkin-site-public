@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Python 教学平台（本地版）
cd /d "%~dp0"

if not exist "CheckinApp.exe" (
    echo [错误] 找不到 CheckinApp.exe，请确认本文件与程序在同一个文件夹里。
    pause
    exit /b 1
)

rem ---- 单机模式：免登录 ----
set "CHECKIN_LOCAL=1"
rem ---- 只保留 Python 教学模块：其余模块的路径全部重定向回 /PyLab ----
set "CHECKIN_ONLY_PYLAB=1"

rem ---- 锁定 Python 解释器 ----
rem 不锁定的话，桥会沿 PATH 自己找；机器上装了多个 Python 时，
rem 有可能挑到没装 matplotlib 的那个（症状：纯 print 正常，一画图就报错）。
rem 这里按「命令行的 python」为准 —— 用户 pip install 装的通常就是它。
rem 如果你手写过 appsettings.Local.json（含 PyLab:PythonPath），就不覆盖。
if not exist "appsettings.Local.json" (
    for /f "delims=" %%i in ('python -c "import sys;print(sys.executable)" 2^>nul') do set "PYLAB_PYTHON=%%i"
)
if defined PYLAB_PYTHON (
    echo 使用 Python: !PYLAB_PYTHON!
    "!PYLAB_PYTHON!" -c "import matplotlib" >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [提示] 这个 Python 还没装绘图库，画图类题目会报错。执行这一行即可：
        echo        pip install matplotlib numpy pandas seaborn networkx
        echo.
    )
) else (
    echo [提示] 没有检测到 Python，代码运行功能将不可用。请先安装 Python 3.11 以上版本。
    echo.
)

rem ---- 找一个空闲端口：5188 起，最多试到 5199 ----
set PORT=5188
:findport
netstat -ano | findstr /r /c:":!PORT! .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    set /a PORT+=1
    if !PORT! GTR 5199 (
        echo [错误] 端口 5188-5199 都被占用，请先关掉占用的程序。
        pause
        exit /b 1
    )
    goto findport
)

if not exist "data" mkdir "data"

echo 正在启动 Python 教学平台（端口 !PORT!）……
start "PyLabServer" /min CheckinApp.exe --urls http://127.0.0.1:!PORT!

rem ---- 等端口就绪，最多 30 秒 ----
set /a WAIT=0
:wait
timeout /t 1 >nul
netstat -ano | findstr /r /c:":!PORT! .*LISTENING" >nul 2>&1
if not errorlevel 1 goto ready
set /a WAIT+=1
if !WAIT! LSS 30 goto wait
echo [错误] 30 秒内没有启动成功，请检查是否缺少运行库或杀毒软件拦截。
pause
exit /b 1

:ready
start "" http://127.0.0.1:!PORT!
echo.
echo 已打开浏览器：http://127.0.0.1:!PORT!
echo 服务在后台运行，用完请双击「停止.bat」关闭。
timeout /t 5 >nul
exit /b 0
