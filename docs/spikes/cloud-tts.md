# Spike: Google Cloud TTS (Chirp 3 HD, Hebrew) as Shaly's voice

Date: 2026-11-13. Code: `spikes/cloud-tts/spike.mjs`. Listening page (local, not in git): `spikes/cloud-tts/out/index.html`.

## Setup facts (checked in the owner's console)
- Project: existing `masha7000` (org `shalom-eliy-org`). A new project was blocked by the project limit, and the billing account is already Paid, so the trial-closure risk that motivated a separate project is gone.
- Key: API key "Shaly voice", restricted to Cloud Text-to-Speech API, header `X-Goog-Api-Key`. In `.env.local` as `GOOGLE_TTS_API_KEY`; owner adds the same in Vercel.
- Quota: Chirp3-HD requests per minute lowered 200 -> 20 (seen working: 429 RESOURCE_EXHAUSTED after 20).
- Google "Budgets & caps" enforced spend caps cover only Cloud Run, Cloud Run Functions, Gemini API, Vertex AI. Not TTS. So the hard stop is our own monthly character counter. Existing ₪10 monthly alert stays.

## Results
- he-IL has 38 voices, 30 of them Chirp3-HD (14 female, 16 male).
- Latency from Israel (desktop, fetch to full MP3): short reply ~0.3 s; long read-back (~140 chars) ~1.3-1.4 s. Median over 50 items 0.3-0.5 s.
- Characters used by the whole spike: ~9,000 of 1,000,000 free a month.
- Pronunciation: owner listens and judges (page has the phone's own voice side by side). he-IL Chirp3-HD has no custom pronunciation, so fixes stay as text replacement before sending.

## Design consequences
- Long replies: split into sentences, request in parallel, play in order, so the first sound comes in ~0.4 s, not ~1.4 s.
- Timeout before falling back to the device voice: per sentence, ~2.5 s (1.5 s in the spec would drop long sentences).
- Cache fixed phrases on the phone.

## Verdict
Pending the owner's listening. Technically GO.
