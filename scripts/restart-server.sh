#!/bin/bash
source ~/.nvm/nvm.sh
pkill -f 'tsx' 2>/dev/null
pkill -f 'next' 2>/dev/null
sleep 2
cd /mnt/d/development/hackathon/loopless/apps/server
pnpm dev > /tmp/server.log 2>&1 &
echo "Server PID: $!"
sleep 5
curl -s http://localhost:3001/health
