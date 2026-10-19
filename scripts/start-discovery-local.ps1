$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
$supervisorPath = Join-Path $PSScriptRoot 'supervise-discovery.mjs'
Start-Process -FilePath $nodePath -ArgumentList @('"' + $supervisorPath + '"') -WorkingDirectory $repoPath -WindowStyle Hidden
