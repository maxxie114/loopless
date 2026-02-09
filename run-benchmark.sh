#!/bin/bash
source ~/.nvm/nvm.sh
cd /mnt/d/development/hackathon/loopless

# Build shared package first
echo "Building shared package..."
pnpm --filter @loopless/shared build

# Start server in background
echo "Starting server..."
cd apps/server
pnpm dev &
SERVER_PID=$!
echo "Server started with PID: $SERVER_PID"

# Wait for server to be ready
echo "Waiting for server..."
for i in {1..30}; do
  if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo "Server is ready!"
    break
  fi
  sleep 1
done

# Check server health
echo "Checking server health..."
curl -s http://localhost:3001/health
echo ""

# Get list of tasks
echo "Fetching task list..."
curl -s http://localhost:3001/api/tasks | head -c 500
echo ""

# Run comprehensive test
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  RUNNING FULL BENCHMARK SUITE"
echo "════════════════════════════════════════════════════════════"
echo ""

cd /mnt/d/development/hackathon/loopless
pnpm exec tsx scripts/test-all-tasks.ts 2>&1

# Keep server running for inspection
# wait $SERVER_PID
