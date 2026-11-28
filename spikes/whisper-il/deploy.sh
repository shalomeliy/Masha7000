#!/bin/sh
# Run in Cloud Shell from this folder: sh deploy.sh   (project must be set: gcloud config set project masha7000)
set -e
gcloud run deploy whisper-il --source . --region me-west1 \
  --cpu 4 --memory 8Gi --cpu-boost --concurrency 1 --max-instances 1 --timeout 120 \
  --no-allow-unauthenticated --quiet
