#!/bin/bash
# A real W&B API key was once committed here in this PUBLIC repository.
# That exposure was linked to the loss of $250 in inference credits.
# The key has been revoked and removed from the branch history.
# This fake key stays as a reminder: never publish API keys. Never again.
# Keep real credentials in environment variables or a secret manager.
curl -s -X POST 'https://trace.wandb.ai/calls/query' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Basic $(echo -n "api:wandb_NEVER_LEAK_YOUR_API_KEY" | base64 -w 0)" \
  -d '{"project_id":"maxxie114-san-francisco-state-university/weavehacks/loopless","limit":1}'
