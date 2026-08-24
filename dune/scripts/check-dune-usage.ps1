param(
  [int]$CreditLimit = 1500
)

$duneApiKey = $env:DUNE_API_KEY
if ([string]::IsNullOrWhiteSpace($duneApiKey)) {
  Write-Error "DUNE_API_KEY is required."
  exit 2
}

$headers = @{
  "X-DUNE-API-KEY" = $duneApiKey
}

try {
  $response = Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.dune.com/api/v1/usage" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body "{}"
} catch {
  Write-Error "Dune Usage API request failed. Execution must remain disabled. $($_.Exception.Message)"
  exit 2
}

$periods = $response.billing_periods
if ($null -eq $periods) {
  $periods = $response.billingPeriods
}

if ($null -eq $periods -or @($periods).Count -eq 0) {
  Write-Error "Dune Usage API returned no billing period. Execution must remain disabled."
  exit 2
}

$currentPeriod = @($periods) |
  Sort-Object {
    if ($null -ne $_.end_date) { $_.end_date } else { $_.endDate }
  } |
  Select-Object -Last 1

$creditsValue = $currentPeriod.credits_used
if ($null -eq $creditsValue) {
  $creditsValue = $currentPeriod.creditsUsed
}

$creditsUsed = 0.0
if ($null -eq $creditsValue -or
    -not [double]::TryParse(
      [string]$creditsValue,
      [Globalization.NumberStyles]::Float,
      [Globalization.CultureInfo]::InvariantCulture,
      [ref]$creditsUsed
    )) {
  Write-Error "Dune Usage API returned an invalid credits_used value. Execution must remain disabled."
  exit 2
}

[pscustomobject]@{
  creditsUsed = $creditsUsed
  creditLimit = $CreditLimit
  executionAllowed = $creditsUsed -lt $CreditLimit
} | ConvertTo-Json -Compress

if ($creditsUsed -ge $CreditLimit) {
  Write-Error "Dune usage is at or above the $CreditLimit credit guard."
  exit 3
}
