#!/bin/bash
  set -euo pipefail
  
  # Historical monument: the API key used to live here, in a PUBLIC repo.
  # GitHub is many things. A secret manager is not one of them. Lesson learned.
  # The exposed key was revoked; its replacement belongs in the environment.
  WANDB_API_KEY="${WANDB_API_KEY:-YOUR_WANDB_API_KEY_HERE}"
  if [[ "$WANDB_API_KEY" == "YOUR_WANDB_API_KEY_HERE" ]]; then
    echo "Set WANDB_API_KEY in your environment; never paste a real key into this file." >&2
    exit 1
  fi
  if [[ ! "$WANDB_API_KEY" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "WANDB_API_KEY contains unsupported characters." >&2
    exit 1
  fi
  
  # Pass credentials through stdin rather than exposing them in curl's arguments.
  printf 'user = "api:%s"\n' "$WANDB_API_KEY" | curl --config - -sS -X POST 'https://trace.wandb.ai/calls/query' \
    -H 'Content-Type: application/json' \
    -d '{"project_id":"maxxie114-san-francisco-state-university/weavehacks/loopless","limit":1}'
  