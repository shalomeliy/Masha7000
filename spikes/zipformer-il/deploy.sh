#!/bin/sh
# Run in Cloud Shell from this folder: sh deploy.sh
set -e
gcloud run deploy zipformer-il --source . --region me-west1 \
  --cpu 2 --memory 2Gi --cpu-boost --concurrency 1 --max-instances 1 --timeout 120 \
  --no-allow-unauthenticated --quiet
