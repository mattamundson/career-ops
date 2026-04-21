# scripts/backup-mcp-profile.ps1
#
# Back up the LinkedIn MCP auth profile directory with retention.
# Per POLICY-mcp-dependencies.md §3.2, backups happen manually (pre-reauth,
# pre-upgrade) and on a weekly schedule. Keeps last 4 generations by default.
#
# Usage:
#   powershell -NoProfile -File scripts/backup-mcp-profile.ps1
#   powershell -NoProfile -File scripts/backup-mcp-profile.ps1 -Keep 8
#   powershell -NoProfile -File scripts/backup-mcp-profile.ps1 -DryRun
#
# Exit codes:
#   0 - backup written (or dry run completed)
#   1 - source profile missing / not readable
#   2 - destination write failed
#   3 - prune phase raised a non-fatal warning (backup still succeeded)

[CmdletBinding()]
param(
    [int]$Keep = 4,
    [string]$Source = "$env:USERPROFILE\.linkedin-mcp\profile",
    [string]$BackupRoot = "$env:USERPROFILE\.linkedin-mcp-backups",
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$warnings = @()

function Write-Info($msg) { Write-Host "[backup-mcp-profile] $msg" }
function Write-Warn($msg) {
    Write-Warning "[backup-mcp-profile] $msg"
    $script:warnings += $msg
}

# --- Validate source ---------------------------------------------------------
if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    Write-Error "[backup-mcp-profile] source profile not found: $Source"
    exit 1
}

$sourceSize = (Get-ChildItem -LiteralPath $Source -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
if (-not $sourceSize) { $sourceSize = 0 }
$sizeMb = [math]::Round($sourceSize / 1MB, 1)
Write-Info "source:      $Source ($sizeMb MB)"

# --- Prepare destination -----------------------------------------------------
$ts = Get-Date -Format "yyyyMMdd-HHmm"
$dst = Join-Path $BackupRoot "profile-$ts"
Write-Info "destination: $dst"

if ($DryRun) {
    Write-Info "DRY RUN - would create $dst and copy $sizeMb MB"
} else {
    try {
        if (-not (Test-Path -LiteralPath $BackupRoot)) {
            New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
        }
        New-Item -ItemType Directory -Path $dst -Force | Out-Null
    } catch {
        Write-Error "[backup-mcp-profile] failed to create destination: $_"
        exit 2
    }

    # Copy profile contents. Exclude invalid-state-* snapshots per §3.1
    # (they're noise and inflate backup size). Use robocopy for speed + mirror
    # semantics; fall back to Copy-Item if robocopy isn't on PATH.
    $robocopy = Get-Command robocopy -ErrorAction SilentlyContinue
    if ($robocopy) {
        # /E  = recurse incl. empty
        # /R:1 /W:1 = retry once, wait 1s (don't hang on locked Cookies DB)
        # /NFL /NDL /NP = quiet output
        # /XD invalid-state-* = exclude stale snapshots
        $rcArgs = @(
            "`"$Source`"", "`"$dst`"",
            '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NP',
            '/XD', 'invalid-state-*'
        )
        $rcOutput = & robocopy @rcArgs 2>&1
        # robocopy exit codes: 0 = nothing copied, 1-7 = success with nuance,
        # 8+ = failure. Treat 0-7 as success.
        if ($LASTEXITCODE -ge 8) {
            Write-Error "[backup-mcp-profile] robocopy failed with exit $LASTEXITCODE`n$rcOutput"
            exit 2
        }
    } else {
        try {
            Copy-Item -LiteralPath $Source -Destination $dst -Recurse -Force -ErrorAction Stop
        } catch {
            Write-Error "[backup-mcp-profile] Copy-Item failed: $_"
            exit 2
        }
    }

    $dstSize = (Get-ChildItem -LiteralPath $dst -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if (-not $dstSize) { $dstSize = 0 }
    Write-Info ("wrote: {0:N1} MB to {1}" -f ($dstSize / 1MB), $dst)
}

# --- Prune old backups -------------------------------------------------------
if (Test-Path -LiteralPath $BackupRoot) {
    $existing = Get-ChildItem -LiteralPath $BackupRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'profile-*' } |
        Sort-Object LastWriteTime -Descending

    if ($existing.Count -gt $Keep) {
        $toPrune = $existing | Select-Object -Skip $Keep
        Write-Info ("pruning {0} old backup(s) beyond keep={1}" -f $toPrune.Count, $Keep)
        foreach ($b in $toPrune) {
            if ($DryRun) {
                Write-Info "  DRY RUN - would remove $($b.FullName)"
            } else {
                try {
                    Remove-Item -LiteralPath $b.FullName -Recurse -Force -ErrorAction Stop
                    Write-Info "  removed $($b.Name)"
                } catch {
                    Write-Warn "failed to remove $($b.Name): $_"
                }
            }
        }
    } else {
        Write-Info ("retention ok - {0} backup(s), keep={1}" -f $existing.Count, $Keep)
    }
}

if ($warnings.Count -gt 0) { exit 3 }
exit 0
