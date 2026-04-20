# Registers the Career-Ops Daily Digest scheduled task.
# Runs every day at 7:55 AM Central Time.
# Requires Gmail OAuth refresh token with gmail.send scope (re-bootstrap if added later).

$preflight = & 'C:\Program Files\nodejs\node.exe' 'C:\Users\mattm\career-ops\scripts\automation-preflight-check.mjs' '--job=gmail-sync'
if ($LASTEXITCODE -ne 0) {
  Write-Host $preflight
  throw 'Preflight failed for Career-Ops Daily Digest. Populate Gmail OAuth keys in .env first (re-bootstrap with gmail.send scope if needed).'
}

$xml = @'
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>2026-04-20T00:00:00</Date>
    <Author>mattm</Author>
    <Description>Send daily digest email at 7:55 AM Central. Pulls top actions, recruiter touches, and yesterday's activity into a glanceable inbox digest.</Description>
    <URI>\Career-Ops Daily Digest</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-04-20T07:55:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <DisallowStartOnRemoteAppSession>false</DisallowStartOnRemoteAppSession>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
    <WakeToRun>true</WakeToRun>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\Program Files\nodejs\node.exe</Command>
      <Arguments>scripts\daily-digest.mjs</Arguments>
      <WorkingDirectory>C:\Users\mattm\career-ops\</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
'@

[System.IO.File]::WriteAllText('C:\Users\mattm\career-ops\scripts\daily-digest-task.xml', $xml, [System.Text.Encoding]::Unicode)
schtasks /create /xml 'C:\Users\mattm\career-ops\scripts\daily-digest-task.xml' /tn 'Career-Ops Daily Digest' /f
schtasks /query /tn 'Career-Ops Daily Digest' /fo LIST
