$ErrorActionPreference = 'Stop'
$pocNode = 'C:\dev\tools\node22\node.exe'
if (-not (Test-Path -LiteralPath $pocNode)) {
  $pocNode = (Get-Command node -ErrorAction Stop).Source
}
Write-Host 'Opening local POC runner at http://127.0.0.1:4195'
Write-Host 'Keep this terminal open. Browser-wallet approvals are required for transactions.'
& $pocNode (Join-Path $PSScriptRoot 'server.mjs')
exit $LASTEXITCODE
