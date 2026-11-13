// Spike: Google Cloud Text-to-Speech, Chirp 3 HD Hebrew voices, for Shaly's spoken replies.
// Throwaway. Reads GOOGLE_TTS_API_KEY from .env.local (Google's key, free tier; never the Anthropic key).
// Writes out/<voice>/<n>.mp3 and out/index.html to listen and compare against the phone's own voice.
// Run: node spikes/cloud-tts/spike.mjs            (all he-IL Chirp3-HD voices)
//      node spikes/cloud-tts/spike.mjs Charon Kore (only these)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '../../.env.local'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);
const KEY = env.GOOGLE_TTS_API_KEY;
if (!KEY) { console.error('GOOGLE_TTS_API_KEY missing in .env.local'); process.exit(1); }
const API = 'https://texttospeech.googleapis.com/v1';
const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY };

// Replies Shaly really says (fixed phrases from Voice.tsx and typical read-backs).
const SENTENCES = [
  'שלי כאן. מה צריך?',
  'הבנתי: עבודה חדשה באילת, אתר 123, ביום שלישי 18 בנובמבר, משמרת לילה. צריך 2 טפסנים וטכנאי מצלמות אחד. לאשר, או שיש עוד תיקון?',
  'לא מצאתי עובד בשם הזה. תגיד שוב את השם?',
  'למי התכוונת: יוסי כהן או יוסי לוי?',
  'שיבצתי את דני ואת אביטל לעבודה בדימונה. נשאר מקום אחד פנוי.',
  'מורן במילואים עד 25 בנובמבר. להציע מישהו אחר במקומה?',
  'יש 3 עבודות שמחכות לשיבוץ השבוע. הראשונה בערד ביום ראשון.',
  'צביקה חולה היום. הכי קרוב לפנות אותו: נתנאל, שהוא גם רתך עם הסמכה בתוקף.',
  'עבודת לינה: יוצאים ביום רביעי בלילה וחוזרים ביום חמישי אחרי הצהריים.',
  'ההסמכה של ליאור לעבודה בגובה פגה בעוד שבועיים.',
  'שלחתי לעובדים את טופס האילוצים לשבוע הבא בוואטסאפ.',
  'אין טפסן פנוי ביום שישי. אפשר להזיז את העבודה ליום ראשון, או לשבץ את אושרי שעובד כבר בבוקר.',
  'מהות העבודה: החלפת אנטנה ובדיקת ריתוך על התורן.',
  'סגרתי את העבודה בקריית גת. עבדו בה שגיא, עמרם ואליהו.',
  'בתור כוננות בסוף השבוע: שגיא ונתנאל.',
  'מחקתי את האילוץ של מורן ליום שני.',
  'העבודה במצפה רמון עברה ל-20 בנובמבר, משמרת יום, משבע בבוקר.',
  'אני לא בטוח שהבנתי. אפשר להגיד את זה במילים אחרות?',
  'אשר',
  'בוטל. לא שמרתי כלום.',
];
const NAMES = [
  'שלי', 'טפסן', 'טפסנים', 'לינה', 'מילואים', 'ערד', 'דימונה', 'אילת', 'מצפה רמון', 'קריית גת',
  'אופקים', 'נתיבות', 'ירוחם', 'בית שאן', 'יוסי', 'אביטל', 'מורן', 'שגיא', 'אליהו', 'צביקה',
  'עמרם', 'נתנאל', 'אושרי', 'ליאור', 'רתך', 'ריתוך', 'כוננות', 'אנטנה', 'הסמכה', 'מהות',
];
const ITEMS = [...SENTENCES, ...NAMES];

const voicesRes = await fetch(`${API}/voices?languageCode=he-IL`, { headers });
if (!voicesRes.ok) { console.error('voices.list failed', voicesRes.status, await voicesRes.text()); process.exit(1); }
const all = (await voicesRes.json()).voices ?? [];
// --sample: only the first 2 sentences (every voice, to pick favourites). Quota is 20 requests a minute: pace 3.2 s.
const sample = process.argv.includes('--sample');
const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const voices = all.filter((v) => v.name.includes('Chirp3-HD') && (!want.length || want.some((w) => v.name.endsWith(`-${w}`))));
console.log(`he-IL voices total ${all.length}, Chirp3-HD picked ${voices.length}`);
if (!voices.length) process.exit(1);

const out = join(here, 'out');
let chars = 0;
const rows = [];
for (const v of voices) {
  const short = v.name.split('-').pop();
  mkdirSync(join(out, short), { recursive: true });
  const times = [];
  for (let i = 0; i < (sample ? 2 : ITEMS.length); i++) {
    if (existsSync(join(out, short, `${i}.mp3`))) continue;
    await sleep(3200);
    const t0 = performance.now();
    const r = await fetch(`${API}/text:synthesize`, {
      method: 'POST', headers,
      body: JSON.stringify({ input: { text: ITEMS[i] }, voice: { languageCode: 'he-IL', name: v.name }, audioConfig: { audioEncoding: 'MP3' } }),
    });
    const ms = Math.round(performance.now() - t0);
    if (!r.ok) { console.error(v.name, i, r.status, (await r.text()).slice(0, 300)); continue; }
    const { audioContent } = await r.json();
    writeFileSync(join(out, short, `${i}.mp3`), Buffer.from(audioContent, 'base64'));
    chars += ITEMS[i].length;
    times.push(ms);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  rows.push({ short, gender: v.ssmlGender, ok: times.length, median: p(0.5), p90: p(0.9), max: sorted.at(-1) });
  console.log(`${short} (${v.ssmlGender}) ok ${times.length}/${ITEMS.length}  median ${p(0.5)}ms  p90 ${p(0.9)}ms`);
}
console.log(`characters used: ${chars} (free tier 1,000,000 a month)`);

const prevPath = join(out, 'results.json');
const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')).rows ?? [] : [];
for (const r of prev) if (!rows.some((x) => x.short === r.short) && r.ok) rows.push(r);
for (const r of rows) if (!r.ok) { const p0 = prev.find((x) => x.short === r.short); if (p0) Object.assign(r, p0); }
const allVoices = all.filter((v) => v.name.includes('Chirp3-HD')).map((v) => ({ short: v.name.split('-').pop(), gender: v.ssmlGender }));
const cols = allVoices.filter((v) => existsSync(join(out, v.short, '0.mp3'))).map((v) => ({ ...v, ...(rows.find((r) => r.short === v.short) ?? {}) }));
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const head = cols.map((r) => `<th>${r.short}<br><small>${r.gender === 'MALE' ? 'גבר' : 'אישה'}${r.median ? ` · ${r.median}ms` : ''}</small></th>`).join('');
const body = ITEMS.map((t, i) => `<tr${i === SENTENCES.length ? ' class="sep"' : ''}><td class="t">${esc(t)}</td><td><button onclick="dev(${i})">טלפון</button></td>${cols.map((r) => existsSync(join(out, r.short, `${i}.mp3`)) ? `<td><button onclick="play('${r.short}/${i}.mp3')">▶</button></td>` : '<td></td>').join('')}</tr>`).join('\n');
writeFileSync(join(out, 'index.html'), `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>קולות ענן לשאלי</title><style>body{font-family:system-ui;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px;text-align:center}td.t{text-align:right;max-width:420px}tr.sep td{border-top:3px solid #333}button{font-size:16px;padding:4px 10px}</style>
<h1>קולות ענן לשאלי</h1><p>כל שורה: "טלפון" = הקול של המכשיר, ▶ = קול ענן. המספר בכותרת = זמן תגובה ממוצע.</p>
<table><tr><th>מה נאמר</th><th>מכשיר</th>${head}</tr>${body}</table>
<script>const items=${JSON.stringify(ITEMS)};const a=new Audio();function play(u){speechSynthesis.cancel();a.src=u;a.play()}
function dev(i){a.pause();speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(items[i]);u.lang='he-IL';const v=speechSynthesis.getVoices().find(v=>/^(he|iw)/i.test(v.lang));if(v)u.voice=v;speechSynthesis.speak(u)}</script></html>`);
writeFileSync(prevPath, JSON.stringify({ chars, rows: rows.filter((r) => r.ok) }, null, 2));
console.log('open spikes/cloud-tts/out/index.html');
