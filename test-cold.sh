#!/bin/bash
curl -s -X POST http://localhost:3001/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"saucedemo-checkout","mode":"cold"}'
echo ""
