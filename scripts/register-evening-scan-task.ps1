# Register Evening Scan Task — Windows Task Scheduler
# Runs a full scan at 6:00 PM CT daily (all sources, not just Greenhouse)
# Then auto-runs prefilter pipeline on new results

$taskName = "Career-Ops Evening Scan"
$description = "Full job scan (all ATS + direct boards) + prefilter at 6 PM CT"
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) { $nodePath = "C:\Program Files\nodejs\node.exe" }

$careerOpsRoot = Split-Path -Parent $PSScriptRoot

# Full scan (all sources) + prefilter auto-run
$scanScript = Join-Path $careerOpsRoot "scripts\auto-scan.mjs"
$argument = "`"$scanScript`""

$action = New-ScheduledTaskAction `
    -Execute $nodePath `
    -Argument $argument `
    -WorkingDirectory $careerOpsRoot

# 6:00 PM Central Time daily
$trigger = New-ScheduledTaskTrigger -Daily -At "18:00"

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

# Remove existing task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description $description

Write-Host "Registered task: $taskName"
Write-Host "  Schedule: Daily at 6:00 PM CT"
Write-Host "  Script:   $scanScript (full scan + prefilter)"
Write-Host "  Node:     $nodePath"
