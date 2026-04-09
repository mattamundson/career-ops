@echo off
cd /d "C:\Users\mattm\career-ops"
node scripts\auto-scan.mjs >> "C:\Users\mattm\career-ops\data\scan-scheduler.log" 2>&1
