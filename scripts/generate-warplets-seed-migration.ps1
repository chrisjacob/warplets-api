$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$csvPath = Join-Path $repoRoot "10x-warplets-metadata.csv"
$outPath = Join-Path $repoRoot "migrations\0003_seed_warplets_metadata.sql"

function SqlText([object]$value) {
  if ($null -eq $value) { return "NULL" }
  $s = [string]$value
  $s = $s.Replace("'", "''")
  return "'" + $s + "'"
}

function SqlInt([object]$value) {
  if ($null -eq $value) { return "NULL" }
  $s = ([string]$value).Trim()
  if ($s -eq "") { return "NULL" }
  $clean = $s -replace "[^0-9-]", ""
  if ($clean -eq "" -or $clean -eq "-") { return "NULL" }
  return $clean
}

$rows = Import-Csv -Path $csvPath
$encoding = New-Object System.Text.UTF8Encoding($false)
$writer = New-Object System.IO.StreamWriter($outPath, $false, $encoding)

try {
  $writer.WriteLine("-- Seed full 10K Warplets metadata from 10x-warplets-metadata.csv")
  $writer.WriteLine("BEGIN TRANSACTION;")

  $rowIndex = 0
  foreach ($row in $rows) {
    $rowIndex++
    $tokenMatch = [regex]::Match($row.Name, "#(\d+)")
    if ($tokenMatch.Success) {
      $tokenId = $tokenMatch.Groups[1].Value
    } else {
      $tokenId = $rowIndex
    }

    $insertSql = @"
INSERT INTO warplets_metadata (
  token_id, name, description, opensea_url, image_url, animation_url,
  x10_level, x10_rank, x10_rarity,
  cast_level, cast_rank, cast_value,
  fid_level, fid_rank, fid_value,
  follower_level, follower_rank, follower_value,
  holder_level, holder_rank, holder_value,
  luck_level, luck_rank, luck_value,
  minter_level, minter_rank, minter_value,
  neynar_level, neynar_rank, neynar_value,
  nft_level, nft_rank, nft_value,
  token_level, token_rank, token_value,
  volume_level, volume_rank, volume_value,
  warplet_colours, warplet_keywords, warplet_traits, warplet_user_is_pro,
  warplet_username_farcaster, warplet_username_x, warplet_wallet,
  avif_url, jpg_url, png_url, webp_url, external_url, secret_level
) VALUES (
  $tokenId, $(SqlText $row.Name), $(SqlText $row.Description), $(SqlText $row.OpenSea), $(SqlText $row.Image), $(SqlText $row.Animation),
  $(SqlText $row.'10X Level'), $(SqlInt $row.'10X Rank'), $(SqlInt $row.'10X Rarity'),
  $(SqlText $row.'Cast Level'), $(SqlInt $row.'Cast Rank'), $(SqlInt $row.'Cast Value'),
  $(SqlText $row.'FID Level'), $(SqlInt $row.'FID Rank'), $(SqlInt $row.'FID Value'),
  $(SqlText $row.'Follower Level'), $(SqlInt $row.'Follower Rank'), $(SqlInt $row.'Follower Value'),
  $(SqlText $row.'Holder Level'), $(SqlInt $row.'Holder Rank'), $(SqlInt $row.'Holder Value'),
  $(SqlText $row.'Luck Level'), $(SqlInt $row.'Luck Rank'), $(SqlInt $row.'Luck Value'),
  $(SqlText $row.'Minter Level'), $(SqlInt $row.'Minter Rank'), $(SqlText $row.'Minter Value'),
  $(SqlText $row.'Neynar Level'), $(SqlInt $row.'Neynar Rank'), $(SqlText $row.'Neynar Value'),
  $(SqlText $row.'NFT Level'), $(SqlInt $row.'NFT Rank'), $(SqlText $row.'NFT Value'),
  $(SqlText $row.'Token Level'), $(SqlInt $row.'Token Rank'), $(SqlText $row.'Token Value'),
  $(SqlText $row.'Volume Level'), $(SqlInt $row.'Volume Rank'), $(SqlText $row.'Volume Value'),
  $(SqlText $row.'Warplet Colours'), $(SqlText $row.'Warplet Keywords'), $(SqlText $row.'Warplet Traits'), $(SqlText $row.'Warplet User Is Pro'),
  $(SqlText $row.'Warplet Username Farcaster'), $(SqlText $row.'Warplet Username X'), $(SqlText $row.'Warplet Wallet'),
  $(SqlText $row.avif), $(SqlText $row.jpg), $(SqlText $row.png), $(SqlText $row.webp), $(SqlText $row.external_url), $(SqlText $row.secret_level)
);
"@

    $writer.WriteLine($insertSql)
  }

  $writer.WriteLine("COMMIT;")
}
finally {
  $writer.Dispose()
}

$insertCount = (Select-String -Path $outPath -Pattern "^INSERT INTO warplets_metadata \(" -AllMatches).Count
Write-Host "Generated $outPath"
Write-Host "CSV rows: $($rows.Count)"
Write-Host "INSERT count: $insertCount"
