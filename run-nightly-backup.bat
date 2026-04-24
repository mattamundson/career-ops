@echo off
cd /d "C:\Users\mattm\career-ops"
node scripts\cron-backup.mjs >> "C:\Users\mattm\career-ops\data\backup-scheduler.log" 2>&1
