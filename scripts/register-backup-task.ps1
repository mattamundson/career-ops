# Registers the Career-Ops Backup scheduled task.
# Runs nightly at 9:30 PM local time and writes allowlisted snapshots under backups/.

$xmlPath = 'C:\Users\mattm\career-ops\scripts\backup-task.xml'
if (-not (Test-Path $xmlPath)) {
  throw "Missing task XML: $xmlPath"
}

schtasks /create /xml $xmlPath /tn 'Career-Ops Backup' /f
Write-Host "Task registered."

schtasks /query /tn 'Career-Ops Backup' /fo LIST
