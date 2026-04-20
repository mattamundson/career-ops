# Registers the Career-Ops Apply-Liveness scheduled task.
# Runs every day at 6:00 AM Central Time, BEFORE the 7:55 AM daily digest.
# This way the digest reflects fresh dead-listing detection.
#
# --render mode: launches headless Playwright for SPA-based ATSs (Workable,
# Lever, Ashby, Greenhouse, SmartRecruiters). Catches "200 + JS-renders dead"
# cases that the cheap HEAD probe misses (V4C.ai-style closed listings).
#
# Execution time: usually <2 min for ~10-20 GO apps. 10-min cap for safety.

$xml = @'
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>2026-04-20T00:00:00</Date>
    <Author>mattm</Author>
    <Description>Probe every GO/Conditional GO/Ready to Submit apply URL for dead listings (HTTP probe + Playwright render for SPAs). Writes data/apply-liveness-YYYY-MM-DD.md so the morning digest reflects fresh data.</Description>
    <URI>\Career-Ops Apply Liveness</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-04-20T06:00:00</StartBoundary>
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
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\Program Files\nodejs\node.exe</Command>
      <Arguments>scripts\check-apply-queue-liveness.mjs --render</Arguments>
      <WorkingDirectory>C:\Users\mattm\career-ops\</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
'@

[System.IO.File]::WriteAllText('C:\Users\mattm\career-ops\scripts\apply-liveness-task.xml', $xml, [System.Text.Encoding]::Unicode)
schtasks /create /xml 'C:\Users\mattm\career-ops\scripts\apply-liveness-task.xml' /tn 'Career-Ops Apply Liveness' /f
schtasks /query /tn 'Career-Ops Apply Liveness' /fo LIST
