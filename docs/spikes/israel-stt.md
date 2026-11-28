# Spike: Hebrew speech-to-text inside Israel (2026-11-28)

Question: can speech-to-text run in Israel (Cloud Run me-west1) fast and accurately enough for the voice assistant?

| Candidate | Result |
|---|---|
| ivrit.ai Whisper large-v3-turbo (CPU, 4 vCPU) | Accurate (exact sentence) but 11-12.6 s for 6.4 s audio, 29 s load. NO-GO for live voice. |
| ivrit.ai zipformer2-66m streaming (CPU, 2 vCPU) | 0.5 s for 6.4 s audio, 2.7 s load. One word wrong ("שאשבץ" -> "שהשבץ"). Published WER 5.1 / 8.9 vs Whisper-turbo 5.3 / 7.1. License CC-BY-4.0 (credit the author). Verdict: GO. Real-voice test (owner, WhatsApp m4a, TV on, 32.7 s, 4 commands): names right (משה כהן, אבי לוי, רעננה), 3 of 4 sentences exact; "שלי" heard as "שעלי", one dropped "ו"; no punctuation. 1.5-2.6 s for 32.7 s of audio (offline); load 2.7 s. |
| GPU VM in Tel Aviv | T4 / A100 exist in me-west1 (no Cloud Run GPU there); T4 end of support Aug 2027; ~$250/month always on; likely quota denial on a new account. Fallback only. |

Code: spikes/whisper-il, spikes/zipformer-il. One speaker so far.
Next: real recordings; then wire as an STT provider (STT_PROVIDER switch) behind the existing server route.
