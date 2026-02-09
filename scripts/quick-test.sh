#!/bin/bash
source ~/.nvm/nvm.sh
cd /mnt/d/development/hackathon/loopless/apps/server

# Start server in background
pnpm dev &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server
sleep 12

# Test health
echo "Testing health..."
curl -s http://localhost:3001/health
echo ""

# Run cold test
echo "Running cold test..."
curl -s -X POST http://localhost:3001/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"saucedemo-checkout","mode":"cold"}'
echo ""

# Keep server running
wait $SERVER_PID
