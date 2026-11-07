# 安裝 USB Guard：登入 Windows 後自動在背景監看（不需系統管理員權限）
$ErrorActionPreference = 'Stop'
$src  = Join-Path $PSScriptRoot '..\usb_guard.py'
$dest = Join-Path $env:LOCALAPPDATA 'usb-guard'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item $src (Join-Path $dest 'usb_guard.py') -Force

$py = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command python.exe).Source }

$action  = New-ScheduledTaskAction -Execute $py -Argument "`"$dest\usb_guard.py`" watch --quiet-ok"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0
Register-ScheduledTask -TaskName 'USB Guard' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'USB Guard'
Write-Host "已安裝並啟動。查看紀錄：python `"$dest\usb_guard.py`" report"
