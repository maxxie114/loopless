#!/bin/bash
source ~/.nvm/nvm.sh
cd /mnt/d/development/hackathon/loopless

# Start backend
nohup pnpm --filter server dev > /tmp/server.log 2>&1 &
echo "Server started on PID: $!"
sleep 5

# Start frontend
nohup pnpm --filter web dev > /tmp/web.log 2>&1 &
echo "Web started on PID: $!"

sleep 5
echo "Checking ports..."
curl -s http://localhost:3001/health
echo ""
curl -sI http://localhost:3000 | head -1
