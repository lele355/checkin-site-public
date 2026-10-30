@echo off
set CHECKIN_LOCAL=1
dotnet run --project D:/checkin/site/CheckinApp/CheckinApp.csproj -c Release --no-build --urls http://127.0.0.1:5188 >> D:/checkin/site/qa/_site_restart.log 2>&1
