param(
  [Parameter(Mandatory=$true)][ValidateSet('backup','verify','restore')][string]$Action,
  [Parameter(Mandatory=$true)][string]$Directory,
  [string]$Destination
)
$ErrorActionPreference = 'Stop'
$qaPriorEncoding = $OutputEncoding
$OutputEncoding = [Text.UTF8Encoding]::new($false)
# Owner runs this in a private terminal. Never put passphrases in arguments/environment/chat.
$qaSecret = Read-Host 'Portable backup passphrase (20+ characters)' -AsSecureString
$qaPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($qaSecret)
try {
  $qaPhrase = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($qaPointer)
  if ($Action -eq 'backup') {
    $qaConfirm = Read-Host 'Repeat passphrase' -AsSecureString
    $qaConfirmPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($qaConfirm)
    try {
      if ($qaPhrase -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($qaConfirmPointer)) { throw 'Passphrases differ' }
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($qaConfirmPointer); $qaConfirm.Dispose() }
  }
  @{ passphrase = $qaPhrase } | ConvertTo-Json -Compress | & node "$PSScriptRoot/recovery.mjs" $Action $Directory $Destination
  if ($LASTEXITCODE -ne 0) { throw 'Recovery command failed' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($qaPointer)
  $qaSecret.Dispose()
  $qaPhrase = $null
  $OutputEncoding = $qaPriorEncoding
}
