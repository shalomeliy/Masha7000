# Spike: small streaming Hebrew speech-to-text on plain CPU inside Israel (Cloud Run me-west1). Throwaway.
import io, time
import numpy as np, sherpa_onnx, soundfile as sf
from fastapi import FastAPI, UploadFile

M = '/app/model/sherpa-onnx'
t0 = time.time()
recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
    tokens=f'{M}/tokens.txt', encoder=f'{M}/encoder.int8.onnx', decoder=f'{M}/decoder.int8.onnx',
    joiner=f'{M}/joiner.int8.onnx', model_type='zipformer2', num_threads=2)
LOAD_S = round(time.time() - t0, 1)
app = FastAPI()

@app.post('/stt')
async def stt(file: UploadFile):
    audio, rate = sf.read(io.BytesIO(await file.read()), dtype='float32', always_2d=True)
    audio = audio.mean(axis=1)
    t = time.time()
    s = recognizer.create_stream()
    # feed in 0.2 s pieces like a live microphone would; remember when the last text appeared
    step = int(rate * 0.2)
    for i in range(0, len(audio), step):
        s.accept_waveform(rate, audio[i:i + step])
        while recognizer.is_ready(s):
            recognizer.decode_stream(s)
    s.accept_waveform(rate, np.zeros(int(1.5 * rate), dtype=np.float32))
    s.input_finished()
    while recognizer.is_ready(s):
        recognizer.decode_stream(s)
    text = recognizer.get_result(s)
    text = text if isinstance(text, str) else getattr(text, 'text', str(text))
    return {'text': text, 'seconds': round(time.time() - t, 2), 'audio_seconds': round(len(audio) / rate, 1), 'model_load_s': LOAD_S}
