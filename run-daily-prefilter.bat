@echo off
cd /d "C:\Users\mattm\career-ops"
node scripts\prefilter-pipeline.mjs >> "C:\Users\mattm\career-ops\data\prefilter-scheduler.log" 2>&1
