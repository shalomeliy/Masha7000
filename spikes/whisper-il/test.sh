#!/bin/sh
# usage: sh test.sh <audio file> ; prints the text and timings. Run it twice: the first call may include a cold start.
URL=$(gcloud run services describe whisper-il --region me-west1 --format 'value(status.url)')
for i in 1 2; do
  S=$(date +%s.%N)
  curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" -F "file=@$1" "$URL/stt"
  E=$(date +%s.%N); echo "   [call $i total: $(echo "$E - $S" | bc) s]"
done
