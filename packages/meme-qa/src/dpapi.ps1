param([ValidateSet('protect','unprotect')][string]$Action)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$qaInput = [Console]::In.ReadToEnd()
$qaEntropy = [Text.Encoding]::UTF8.GetBytes('10x-meme-qa-wallet-v1')
if ($Action -eq 'protect') {
  $qaBytes = [Text.Encoding]::UTF8.GetBytes($qaInput)
  try {
    $qaProtected = [Security.Cryptography.ProtectedData]::Protect($qaBytes, $qaEntropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Convert]::ToBase64String($qaProtected))
  } finally { [Array]::Clear($qaBytes, 0, $qaBytes.Length) }
} else {
  $qaBytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($qaInput), $qaEntropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($qaBytes)) }
  finally { [Array]::Clear($qaBytes, 0, $qaBytes.Length) }
}
