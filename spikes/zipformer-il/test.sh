#!/bin/sh
# needs STT_TOKEN exported (the same one used by deploy.sh)
# usage: sh test.sh <wav file>   (run twice inside: the first call may include a cold start)
URL=$(gcloud run services describe zipformer-il --region me-west1 --format 'value(status.url)')
for i in 1 2 3; do
  curl -s -H "X-Stt-Token: $STT_TOKEN" -F "file=@$1" "$URL/stt"; echo
done
