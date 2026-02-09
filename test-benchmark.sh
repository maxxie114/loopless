#!/bin/bash
source ~/.nvm/nvm.sh
cd /mnt/d/development/hackathon/loopless

echo "Building..."
pnpm --filter @loopless/shared build

cd apps/server
echo "Starting server..."
./node_modules/.bin/tsx src/index.ts &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

sleep 12

echo "Testing health..."
curl -s http://localhost:3001/health
echo ""

# Run only saucedemo first as a test
echo "Running saucedemo-checkout COLD..."
curl -s -X POST http://localhost:3001/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"saucedemo-checkout","mode":"cold"}'
echo ""

# Wait for completion
echo "Waiting 3 minutes for cold run..."
sleep 180

echo "Getting cold run result..."
curl -s http://localhost:3001/api/runs | head -c 1000
echo ""

# Now warm
echo "Running saucedemo-checkout WARM..."
curl -s -X POST http://localhost:3001/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"saucedemo-checkout","mode":"warm"}'
echo ""

echo "Waiting 3 minutes for warm run..."
sleep 180

echo "Getting results..."
curl -s http://localhost:3001/api/runs | head -c 2000
echo ""

# Kill server
kill $SERVER_PID 2>/dev/null
