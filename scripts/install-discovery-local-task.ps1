$ErrorActionPreference = 'Stop'
$taskName = '10X-Discovery-Local'
$starter = Join-Path $PSScriptRoot 'start-discovery-local.ps1'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $starter + '"'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -ne $arguments) { throw 'A different task already uses this name; refusing to overwrite it.' }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$login = New-ScheduledTaskTrigger -AtLogOn -User $userId
$retry = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($login, $retry) -Principal $principal -Settings $settings -Description 'Local-only 10X discovery, chart refresh and daily review supervisor. No deployment or financial writes.' -Force | Select-Object TaskName,State
Start-ScheduledTask -TaskName $taskName
