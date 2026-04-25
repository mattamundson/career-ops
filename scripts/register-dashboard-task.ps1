# Registers the Career-Ops Dashboard task from the checked-in XML.
# The XML runs post-apply-refresh hourly (index + dashboard.html + review.html)
# and uses a 10-minute execution limit to avoid Task Scheduler 267014 kills.

$xmlPath = 'C:\Users\mattm\career-ops\scripts\dashboard-hourly.xml'
if (-not (Test-Path $xmlPath)) {
  throw "Missing task XML: $xmlPath"
}

schtasks /create /xml $xmlPath /tn 'Career-Ops Dashboard' /f
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register Career-Ops Dashboard task from $xmlPath"
}
Write-Host "Task registered."

schtasks /query /tn 'Career-Ops Dashboard' /fo LIST
if ($LASTEXITCODE -ne 0) {
  throw 'Career-Ops Dashboard task registration succeeded, but query failed.'
}
