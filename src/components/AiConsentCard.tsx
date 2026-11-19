import { ShieldCheck } from 'lucide-react'
import { tx } from '../i18n'

// Asked once on this device, the first time a request needs Claude (App Store 5.1.2(i), Google Play
// User Data): what goes out, to whom, and that "no" keeps the free part working. src/lib/aiConsent.ts.
export function AiConsentCard({ onAgree, onDecline }: { onAgree: () => void; onDecline: () => void }) {
  return (
    <div role="dialog" aria-labelledby="ai-consent-title" className="w-full max-w-sm space-y-3 rounded-2xl border border-sky-500/50 bg-slate-900 p-4 text-sm text-slate-200">
      <h2 id="ai-consent-title" className="flex items-center gap-2 text-base font-semibold text-slate-100">
        <ShieldCheck size={20} aria-hidden className="shrink-0 text-sky-300" />
        {tx('לפני ש-Shali שולח מידע החוצה')}
      </h2>
      <ul className="list-disc space-y-1 ps-5">
        <li>{tx('מה שאומרים ל-Shali, יחד עם רשימות העבודה (שמות עובדים, טלפונים, הסמכות, אילוצים ועבודות), נשלח ל-Claude של חברת Anthropic. רק כשהאפליקציה לא יודעת לעשות את זה לבד.')}</li>
        <li>{tx('המשפטים ש-Shali אומר בקול נשלחים ל-Google כדי להפוך לקול.')}</li>
        <li>{tx('לפי התנאים שלהן, Anthropic ו-Google לא מאמנות על זה את המודלים שלהן. אפשר לבטל בכל רגע בהגדרות, בחשבון שלי.')}</li>
      </ul>
      <a href="/privacy.html" target="_blank" rel="noopener" className="inline-block text-sky-300 underline">
        {tx('מדיניות פרטיות')}
      </a>
      <div className="flex gap-3">
        <button type="button" onClick={onAgree} className="min-h-12 flex-1 rounded-xl bg-emerald-600 font-semibold text-white">
          {tx('מסכים')}
        </button>
        <button type="button" onClick={onDecline} className="min-h-12 flex-1 rounded-xl border border-slate-700 text-slate-300">
          {tx('לא עכשיו')}
        </button>
      </div>
    </div>
  )
}
