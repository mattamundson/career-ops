$preflight = & 'C:\Program Files\nodejs\node.exe' 'C:\Users\mattm\career-ops\scripts\automation-preflight-check.mjs' '--job=gmail-sync'
if ($LASTEXITCODE -ne 0) {
  Write-Host $preflight
  throw 'Preflight failed for Career-Ops Gmail Sync. Populate the required Gmail OAuth keys in .env before registering the task.'
}

$xml = @'
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>2026-04-11T00:00:00</Date>
    <Author>mattm</Author>
    <Description>Poll Gmail recruiter messages and sync recruiter replies into responses.md and applications.md.</Description>
    <URI>\Career-Ops Gmail Sync</URI>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>2026-04-11T07:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT30M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
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
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\Program Files\nodejs\node.exe</Command>
      <Arguments>scripts\gmail-recruiter-sync.mjs --apply</Arguments>
      <WorkingDirectory>C:\Users\mattm\career-ops\</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
'@

[System.IO.File]::WriteAllText('C:\Users\mattm\career-ops\scripts\gmail-sync-task.xml', $xml, [System.Text.Encoding]::Unicode)
schtasks /create /xml 'C:\Users\mattm\career-ops\scripts\gmail-sync-task.xml' /tn 'Career-Ops Gmail Sync' /f
schtasks /query /tn 'Career-Ops Gmail Sync' /fo LIST
