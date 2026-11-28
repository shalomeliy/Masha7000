#!/bin/sh
# Run in Cloud Shell from this folder: sh deploy.sh
set -e
# Needs a secret first:  export STT_TOKEN=$(openssl rand -hex 24)   (keep it: it goes to Vercel as ISRAEL_STT_TOKEN)
[ -n "$STT_TOKEN" ] || { echo "export STT_TOKEN first"; exit 1; }
gcloud run deploy zipformer-il --source . --region me-west1 \
  --cpu 2 --memory 2Gi --cpu-boost --concurrency 1 --max-instances 1 --timeout 120 \
  --allow-unauthenticated --set-env-vars STT_TOKEN="$STT_TOKEN" --quiet
