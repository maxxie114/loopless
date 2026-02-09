#!/bin/bash
curl -s -X POST 'https://trace.wandb.ai/calls/query' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Basic $(echo -n "api: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" | base64 -w 0)" \
  -d '{"project_id":"maxxie114-san-francisco-state-university/weavehacks/loopless","limit":1}'
