// Spike: Claude Haiku + Shali's voice through Google's EU endpoints (Vertex). Throwaway. No npm deps.
// Run in Google Cloud Shell (already signed in): node run.mjs <PROJECT_NUMBER_OR_ID>
// Auth = your own gcloud login. No key is stored anywhere. Never uses ANTHROPIC_API_KEY.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const PROJECT = process.argv[2]
if (!PROJECT) { console.error('usage: node run.mjs <project>'); process.exit(1) }
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5'
const token = execSync('gcloud auth print-access-token').toString().trim()
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const TEXT = 'שלום, אני שאלי. מחר בבוקר יש שלוש משמרות פתוחות, רוצה שאשבץ?'
const out = []
const ms = (t) => Math.round(performance.now() - t)
const log = (k, v) => { out.push([k, v]); console.log(k.padEnd(34), v) }

// 1. Claude Haiku through EU locations (first one that answers wins; tell us which)
for (const loc of ['eu', 'europe-west1', 'europe-west4']) {
  const host = loc === 'eu' ? 'aiplatform.eu.rep.googleapis.com' : `${loc}-aiplatform.googleapis.com`
  const url = `https://${host}/v1/projects/${PROJECT}/locations/${loc}/publishers/anthropic/models/${MODEL}:rawPredict`
  for (let i = 0; i < 3; i++) {
    const t = performance.now()
    try {
      const r = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify({
        anthropic_version: 'vertex-2023-10-16', max_tokens: 60,
        messages: [{ role: 'user', content: 'ענה במשפט אחד בעברית: מה בירת ישראל?' }] }) })
      const j = await r.json()
      if (!r.ok) { log(`claude ${loc} #${i + 1}`, `FAIL ${r.status} ${JSON.stringify(j).slice(0, 160)}`); break }
      log(`claude ${loc} #${i + 1}`, `${ms(t)}ms  "${j.content?.[0]?.text}"`)
    } catch (e) { log(`claude ${loc} #${i + 1}`, `ERR ${e.message}`); break }
  }
}

// 2. Chirp 3 HD Hebrew, EU endpoint
{
  const t = performance.now()
  const r = await fetch('https://eu-texttospeech.googleapis.com/v1/text:synthesize', { method: 'POST', headers: H, body: JSON.stringify({
    input: { text: TEXT }, voice: { languageCode: 'he-IL', name: 'he-IL-Chirp3-HD-Sadaltager' }, audioConfig: { audioEncoding: 'MP3' } }) })
  const j = await r.json()
  if (r.ok) { writeFileSync('chirp-eu.mp3', Buffer.from(j.audioContent, 'base64')); log('chirp3-hd eu', `${ms(t)}ms -> chirp-eu.mp3`) }
  else log('chirp3-hd eu', `FAIL ${r.status} ${JSON.stringify(j).slice(0, 200)}`)
}

// 3. Gemini TTS (the live voice) on Vertex, EU locations
for (const loc of ['eu', 'europe-west1', 'europe-west4']) {
  const host = loc === 'eu' ? 'aiplatform.eu.rep.googleapis.com' : `${loc}-aiplatform.googleapis.com`
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts'
  const url = `https://${host}/v1/projects/${PROJECT}/locations/${loc}/publishers/google/models/${model}:generateContent`
  const t = performance.now()
  try {
    const r = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: TEXT }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Sadaltager' } } } } }) })
    const j = await r.json()
    const b64 = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data
    if (r.ok && b64) {
      const raw = Buffer.from(b64, 'base64')
      const isWav = raw.subarray(0, 4).toString() === 'RIFF'
      writeFileSync(`gemini-${loc}.${isWav ? 'wav' : 'pcm'}`, raw)
      log(`gemini-tts ${loc}`, `${ms(t)}ms -> gemini-${loc}.${isWav ? 'wav' : 'pcm'}`)
      break
    }
    log(`gemini-tts ${loc}`, `FAIL ${r.status} ${JSON.stringify(j).slice(0, 200)}`)
  } catch (e) { log(`gemini-tts ${loc}`, `ERR ${e.message}`) }
}
writeFileSync('results.txt', out.map((x) => x.join('  ')).join('\n'))
console.log('\ndone: results.txt + audio files in this folder')
