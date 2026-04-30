# seed-remote.ps1
# Applies the 10K warplets_metadata seed to the remote (production) D1 database
# in small chunks to avoid Cloudflare D1 payload/timeout limits.
#
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\seed-remote.ps1
# Optional: -ChunkSize <rows_per_batch>  (default: 200)

param(
    [int]$ChunkSize = 200,
    [int]$StartToken = 1
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$csvPath = Join-Path $repoRoot "10x-warplets-metadata.csv"
$tmpDir = Join-Path $env:TEMP "warplets-seed-chunks"

if (-not (Test-Path $csvPath)) {
    Write-Error "CSV not found: $csvPath"
    exit 1
}

# Clean up any previous temp chunks
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
New-Item -ItemType Directory -Path $tmpDir | Out-Null

Write-Host "Reading CSV..."
$rows = Import-Csv -Path $csvPath
$total = $rows.Count
Write-Host "Total rows: $total"

# Filter to rows at or after StartToken
if ($StartToken -gt 1) {
    Write-Host "Resuming from token_id >= $StartToken ..."
    $rows = $rows | Where-Object {
        $m = [regex]::Match($_.Name, "#(\d+)")
        $m.Success -and ([int]$m.Groups[1].Value) -ge $StartToken
    }
    Write-Host "Rows to insert: $($rows.Count)"
    $total = $rows.Count
}

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

function WriteChunk($chunkRows, $index) {
    $file = Join-Path $tmpDir ("chunk_{0:D4}.sql" -f $index)
    $sb = [System.Text.StringBuilder]::new()
    foreach ($row in $chunkRows) {
        $tokenMatch = [regex]::Match($row.Name, "#(\d+)")
        $tokenId = if ($tokenMatch.Success) { $tokenMatch.Groups[1].Value } else { "NULL" }

        [void]$sb.AppendLine(
            "INSERT OR IGNORE INTO warplets_metadata (" +
            "token_id,name,description,opensea_url,image_url,animation_url," +
            "x10_level,x10_rank,x10_rarity," +
            "cast_level,cast_rank,cast_value," +
            "fid_level,fid_rank,fid_value," +
            "follower_level,follower_rank,follower_value," +
            "holder_level,holder_rank,holder_value," +
            "luck_level,luck_rank,luck_value," +
            "minter_level,minter_rank,minter_value," +
            "neynar_level,neynar_rank,neynar_value," +
            "nft_level,nft_rank,nft_value," +
            "token_level,token_rank,token_value," +
            "volume_level,volume_rank,volume_value," +
            "warplet_colours,warplet_keywords,warplet_traits,warplet_user_is_pro," +
            "warplet_username_farcaster,warplet_username_x,warplet_wallet," +
            "avif_url,jpg_url,png_url,webp_url,external_url,secret_level" +
            ") VALUES (" +
            $tokenId + "," +
            (SqlText $row.Name) + "," +
            (SqlText $row.Description) + "," +
            (SqlText $row.OpenSea) + "," +
            (SqlText $row.Image) + "," +
            (SqlText $row.Animation) + "," +
            (SqlText $row.'10X Level') + "," +
            (SqlInt $row.'10X Rank') + "," +
            (SqlInt $row.'10X Rarity') + "," +
            (SqlText $row.'Cast Level') + "," +
            (SqlInt $row.'Cast Rank') + "," +
            (SqlInt $row.'Cast Value') + "," +
            (SqlText $row.'FID Level') + "," +
            (SqlInt $row.'FID Rank') + "," +
            (SqlInt $row.'FID Value') + "," +
            (SqlText $row.'Follower Level') + "," +
            (SqlInt $row.'Follower Rank') + "," +
            (SqlInt $row.'Follower Value') + "," +
            (SqlText $row.'Holder Level') + "," +
            (SqlInt $row.'Holder Rank') + "," +
            (SqlInt $row.'Holder Value') + "," +
            (SqlText $row.'Luck Level') + "," +
            (SqlInt $row.'Luck Rank') + "," +
            (SqlInt $row.'Luck Value') + "," +
            (SqlText $row.'Minter Level') + "," +
            (SqlInt $row.'Minter Rank') + "," +
            (SqlText $row.'Minter Value') + "," +
            (SqlText $row.'Neynar Level') + "," +
            (SqlInt $row.'Neynar Rank') + "," +
            (SqlText $row.'Neynar Value') + "," +
            (SqlText $row.'NFT Level') + "," +
            (SqlInt $row.'NFT Rank') + "," +
            (SqlText $row.'NFT Value') + "," +
            (SqlText $row.'Token Level') + "," +
            (SqlInt $row.'Token Rank') + "," +
            (SqlText $row.'Token Value') + "," +
            (SqlText $row.'Volume Level') + "," +
            (SqlInt $row.'Volume Rank') + "," +
            (SqlText $row.'Volume Value') + "," +
            (SqlText $row.'Warplet Colours') + "," +
            (SqlText $row.'Warplet Keywords') + "," +
            (SqlText $row.'Warplet Traits') + "," +
            (SqlText $row.'Warplet User Is Pro') + "," +
            (SqlText $row.'Warplet Username Farcaster') + "," +
            (SqlText $row.'Warplet Username X') + "," +
            (SqlText $row.'Warplet Wallet') + "," +
            (SqlText $row.avif) + "," +
            (SqlText $row.jpg) + "," +
            (SqlText $row.png) + "," +
            (SqlText $row.webp) + "," +
            (SqlText $row.external_url) + "," +
            (SqlText $row.secret_level) + ");"
        )
    }
    [System.IO.File]::WriteAllText($file, $sb.ToString(), [System.Text.Encoding]::UTF8)
    return $file
}

# Split into chunks and apply each
$processed = 0
$chunkNum = 0
$totalChunks = [Math]::Ceiling($total / $ChunkSize)

for ($i = 0; $i -lt $total; $i += $ChunkSize) {
    $chunk = $rows[$i..([Math]::Min($i + $ChunkSize - 1, $total - 1))]
    $chunkNum++
    $chunkFile = WriteChunk $chunk $chunkNum

    Write-Host ("Applying chunk {0}/{1} (rows {2}-{3})..." -f $chunkNum, $totalChunks, ($i + 1), ([Math]::Min($i + $ChunkSize, $total)))

    $result = pnpm exec wrangler d1 execute warplets --remote --file $chunkFile 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Chunk $chunkNum failed:`n$result"
        exit 1
    }
    $processed += $chunk.Count
}

Write-Host ""
Write-Host "Done! Seeded $processed rows in $chunkNum chunks."

# Verify
Write-Host "Verifying row count..."
pnpm exec wrangler d1 execute warplets --remote --command "SELECT COUNT(*) AS total_rows, MIN(token_id) AS min_token, MAX(token_id) AS max_token FROM warplets_metadata;"

# Cleanup
Remove-Item $tmpDir -Recurse -Force
