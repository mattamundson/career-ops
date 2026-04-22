@echo off
cd /d "C:\Users\mattm\career-ops"
node scripts\cron-prefilter.mjs >> "C:\Users\mattm\career-ops\data\prefilter-scheduler.log" 2>&1
