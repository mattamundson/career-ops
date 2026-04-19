$preflight = & 'C:\Program Files\nodejs\node.exe' 'C:\Users\mattm\career-ops\scripts\automation-preflight-check.mjs' '--job=cadence-alert'
Write-Host $preflight

$xml = @'
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>2026-04-11T00:00:00</Date>
    <Author>mattm</Author>
    <Description>Run follow-up cadence checks and send stale-application alerts through the configured notifier path.</Description>
    <URI>\Career-Ops Cadence Alert</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-04-11T09:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
    <CalendarTrigger>
      <StartBoundary>2026-04-11T16:00:00</StartBoundary>
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
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
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
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\Program Files\nodejs\node.exe</Command>
      <Arguments>scripts\check-cadence-alert.mjs</Arguments>
      <WorkingDirectory>C:\Users\mattm\career-ops\</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
'@

[System.IO.File]::WriteAllText('C:\Users\mattm\career-ops\scripts\cadence-alert-task.xml', $xml, [System.Text.Encoding]::Unicode)
schtasks /create /xml 'C:\Users\mattm\career-ops\scripts\cadence-alert-task.xml' /tn 'Career-Ops Cadence Alert' /f
schtasks /query /tn 'Career-Ops Cadence Alert' /fo LIST
