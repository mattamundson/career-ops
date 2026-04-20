# Registers the Career-Ops Health Check scheduled task.
# Runs every 6 hours (4 times/day). Silent unless something needs attention.

$xml = @'
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>2026-04-20T00:00:00</Date>
    <Author>mattm</Author>
    <Description>Run health-check.mjs every 6 hours. Notifies via toast/Pushover when any check fails or 3+ checks warn. Silent otherwise.</Description>
    <URI>\Career-Ops Health Check</URI>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>2026-04-20T08:15:00</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT6H</Interval>
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
    <ExecutionTimeLimit>PT3M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\Program Files\nodejs\node.exe</Command>
      <Arguments>scripts\cron-health-check.mjs</Arguments>
      <WorkingDirectory>C:\Users\mattm\career-ops\</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
'@

[System.IO.File]::WriteAllText('C:\Users\mattm\career-ops\scripts\health-check-task.xml', $xml, [System.Text.Encoding]::Unicode)
schtasks /create /xml 'C:\Users\mattm\career-ops\scripts\health-check-task.xml' /tn 'Career-Ops Health Check' /f
schtasks /query /tn 'Career-Ops Health Check' /fo LIST
