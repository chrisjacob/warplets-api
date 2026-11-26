# Run manually on the Windows host. This restarts only this runner and the
# existing app-local connector; it does not deploy or submit transactions.
$ErrorActionPreference = 'Stop'
$pocRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$pocNode = 'C:\dev\tools\node22\node.exe'
$pocCloudflared = 'C:\dev\tools\bin\cloudflared.exe'
$pocDirectory = Join-Path $env:LOCALAPPDATA 'SolanaPocRunner'
$pocTunnel = Join-Path $pocRoot 'work/app-local-tunnel-restored.yml'
foreach ($required in @($pocNode, $pocCloudflared, $pocTunnel)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Missing required local file: $required" }
}

# Preserve active operations. The owner can finish/recover them before retrying.
$pocStatus = $null
try { $pocStatus = Invoke-RestMethod 'http://127.0.0.1:4195/api/state' -TimeoutSec 3 } catch {}
if ($pocStatus) {
  $pending = @($pocStatus.state.attempts | Where-Object status -in @('prepared','submitted','unknown','verification-failed'))
  $running = @($pocStatus.state.checks | Where-Object status -eq 'running')
  if ($pending.Count -or $running.Count) { throw 'Finish/recover the pending action or local check before restarting for mobile access.' }
}

New-Item -ItemType Directory -Path $pocDirectory -Force | Out-Null
$pocAccessFile = Join-Path $pocDirectory 'mobile.json'
if (-not (Test-Path -LiteralPath $pocAccessFile)) {
  $accessBytes = New-Object byte[] 32
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($accessBytes) } finally { $random.Dispose() }
  $accessKey = [Convert]::ToBase64String($accessBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  $mobile = @{ origin='https://app-local.10x.meme'; prefix='/poc'; accessKey=$accessKey }
  [IO.File]::WriteAllText($pocAccessFile, ($mobile | ConvertTo-Json))
}
$pocMobile = Get-Content -LiteralPath $pocAccessFile -Raw | ConvertFrom-Json
if ($pocMobile.origin -ne 'https://app-local.10x.meme' -or $pocMobile.prefix -ne '/poc' -or $pocMobile.accessKey -notmatch '^[A-Za-z0-9_-]{43}$') { throw 'Unexpected existing mobile configuration; inspect it before continuing.' }

$pocOriginal = Get-Content -LiteralPath $pocTunnel -Raw
$pocBackup = $pocTunnel + '.before-poc'
$pocRule = @'
ingress:
  - hostname: app-local.10x.meme
    path: ^/poc(/.*)?$
    service: http://127.0.0.1:4195
    originRequest:
      httpHostHeader: app-local.10x.meme
'@
if ($pocOriginal -notmatch 'path:.*poc') {
  if ([regex]::Matches($pocOriginal, '(?m)^ingress:').Count -ne 1) { throw 'Unexpected tunnel configuration' }
  if (-not (Test-Path -LiteralPath $pocBackup)) { Copy-Item -LiteralPath $pocTunnel -Destination $pocBackup }
  [IO.File]::WriteAllText($pocTunnel, $pocOriginal.Replace('ingress:', $pocRule.TrimEnd()))
}
& $pocCloudflared tunnel --config $pocTunnel ingress validate
if ($LASTEXITCODE -ne 0) {
  [IO.File]::WriteAllText($pocTunnel, $pocOriginal)
  throw 'Tunnel validation failed; original configuration restored.'
}

$pocLock = Join-Path $pocDirectory 'runner.lock'
if (Test-Path -LiteralPath $pocLock) {
  $runnerPid = [int](Get-Content -LiteralPath $pocLock -Raw)
  $runnerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $runnerPid"
  if ($runnerProcess) {
    if ($runnerProcess.CommandLine -notmatch 'platform[/\\]poc[/\\]runner[/\\]server\.mjs') { throw 'Runner lock PID belongs to a different command; refusing to stop it.' }
    Stop-Process -Id $runnerPid
    Wait-Process -Id $runnerPid -Timeout 10 -ErrorAction SilentlyContinue
  }
}
$newRunner = Start-Process -FilePath $pocNode -ArgumentList 'platform/poc/runner/server.mjs' -WorkingDirectory $pocRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $pocDirectory 'server-mobile.stdout.log') -RedirectStandardError (Join-Path $pocDirectory 'server-mobile.stderr.log') -PassThru
$ready = $false
for ($i=0; $i -lt 30; $i++) {
  try { $null = Invoke-RestMethod 'http://127.0.0.1:4195/api/state' -TimeoutSec 2; $ready=$true; break } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $ready) { throw 'Runner did not start. Inspect server-mobile.stderr.log; tunnel was not restarted.' }

$connectors = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -and $_.CommandLine.Contains($pocTunnel) })
foreach ($connector in $connectors) {
  Stop-Process -Id $connector.ProcessId
  Wait-Process -Id $connector.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
}
$newTunnel = Start-Process -FilePath $pocCloudflared -ArgumentList @('tunnel','--config',('"'+$pocTunnel+'"'),'run') -WorkingDirectory $pocRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $pocDirectory 'tunnel-mobile.stdout.log') -RedirectStandardError (Join-Path $pocDirectory 'tunnel-mobile.stderr.log') -PassThru
Write-Host 'Private mobile link (keep it private):'
Write-Host ($pocMobile.origin + $pocMobile.prefix + '/#access=' + $pocMobile.accessKey)
Write-Host "Runner PID: $($newRunner.Id); tunnel PID: $($newTunnel.Id). Keep this computer awake."
Write-Host 'The existing app remains at /. The runner is under /poc/. No deployment or financial transaction occurred.'
