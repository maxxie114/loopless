#!/bin/bash
source ~/.nvm/nvm.sh
cd /mnt/d/development/hackathon/loopless/apps/server

# Kill any existing servers
pkill -f tsx 2>/dev/null
sleep 2

# Start server
./node_modules/.bin/tsx src/index.ts &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for startup
sleep 10

# Test health
echo "Testing health endpoint..."
curl -s http://localhost:3001/health
echo ""
echo "Exit code: $?"

# Keep server running
wait $SERVER_PID
