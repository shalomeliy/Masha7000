import { useState } from 'react'
import { Copy, MessageCircle, Share2 } from 'lucide-react'
import { Sheet } from '../../components/Sheet'
import { whatsappHref } from '../../lib/report'

// Shows the report text before sending. WhatsApp opens with it ready (the manager picks the chat
// or group there); the phone's share sheet and copy are there for any other app.
export function ShareSheet({ title, text, onClose }: { title: string; text: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const canShare = typeof navigator.share === 'function'

  const close = () => {
    setCopied(false)
    onClose()
  }

  const copy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Sheet open={text !== null} title={title} onClose={close}>
      <pre dir="rtl" className="max-h-[45dvh] overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-sans text-sm whitespace-pre-wrap text-slate-200">
        {text}
      </pre>
      <a
        href={text ? whatsappHref(text) : undefined}
        target="_blank"
        rel="noreferrer"
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950"
      >
        <MessageCircle size={20} aria-hidden />
        שליחה בוואטסאפ
      </a>
      <div className="flex gap-2">
        {canShare && (
          <button
            type="button"
            // Cancelling the phone's share sheet rejects; nothing to do then.
            onClick={() => text && navigator.share({ text }).catch(() => {})}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 text-slate-200"
          >
            <Share2 size={18} aria-hidden />
            שיתוף
          </button>
        )}
        <button type="button" onClick={copy} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 text-slate-200">
          <Copy size={18} aria-hidden />
          {copied ? 'הועתק' : 'העתקה'}
        </button>
        <button type="button" onClick={close} className="min-h-12 flex-1 rounded-xl border border-slate-700 text-slate-300">
          סגירה
        </button>
      </div>
    </Sheet>
  )
}
