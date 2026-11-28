# Spike: Hebrew speech-to-text that runs inside Israel (Cloud Run me-west1). Throwaway.
import tempfile, time
from fastapi import FastAPI, UploadFile
from faster_whisper import WhisperModel

t0 = time.time()
model = WhisperModel('ivrit-ai/whisper-large-v3-turbo-ct2', device='cpu', compute_type='int8')
LOAD_S = round(time.time() - t0, 1)
app = FastAPI()

@app.post('/stt')
async def stt(file: UploadFile):
    with tempfile.NamedTemporaryFile(suffix='.audio') as f:
        f.write(await file.read()); f.flush()
        t = time.time()
        segs, info = model.transcribe(f.name, language='he', beam_size=1, vad_filter=True)
        text = ' '.join(s.text.strip() for s in segs)
        return {'text': text, 'seconds': round(time.time() - t, 2), 'audio_seconds': round(info.duration, 1), 'model_load_s': LOAD_S}
