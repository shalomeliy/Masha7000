#!/bin/sh
# usage: sh test.sh <wav file>   (run twice inside: the first call may include a cold start)
URL=$(gcloud run services describe zipformer-il --region me-west1 --format 'value(status.url)')
for i in 1 2 3; do
  curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" -F "file=@$1" "$URL/stt"; echo
done
