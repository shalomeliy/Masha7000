import { useEffect, useState } from 'react'
import { Copy, Image as ImageIcon, Loader2, MessageCircle } from 'lucide-react'
import { Sheet } from '../../components/Sheet'
import { reportText, whatsappHref } from '../../lib/report'
import type { Report } from '../../lib/report'
import { reportImage } from '../../lib/reportImage'

// Shows the report as an image card before sending. The image goes out through the phone's share
// sheet (pick WhatsApp there); the text version opens WhatsApp directly, or is copied.
export function ShareSheet({ title, report, warning, onClose }: { title: string; report: Report | null; warning?: string; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const text = report ? reportText(report) : ''

  // Drawn as soon as the sheet opens: the share call must come straight from the tap, so the
  // file has to be ready before it.
  useEffect(() => {
    if (!report) return
    let alive = true
    let url: string | null = null
    reportImage(report)
      .then((blob) => {
        if (!alive) return
        url = URL.createObjectURL(blob)
        setFile(new File([blob], 'shifts.png', { type: 'image/png' }))
        setPreview(url)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
      setFile(null)
      setPreview(null)
      setFailed(false)
      setCopied(false)
    }
  }, [report])

  const shareImage = () => {
    if (!file) return
    if (navigator.canShare?.({ files: [file] })) {
      // Cancelling the phone's share sheet rejects; nothing to do then.
      navigator.share({ files: [file] }).catch(() => {})
      return
    }
    // A computer without file sharing: save the picture, then attach it in WhatsApp.
    const a = document.createElement('a')
    a.href = preview!
    a.download = 'shifts.png'
    a.click()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Sheet open={report !== null} title={title} onClose={onClose}>
      {warning && <p className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">{warning}</p>}
      <div className="max-h-[50dvh] overflow-y-auto rounded-xl border border-slate-800 bg-slate-950">
        {preview ? (
          <img src={preview} alt="תמונת הסידור שתישלח" className="block w-full" />
        ) : failed ? (
          <p className="p-4 text-sm text-red-300">לא הצלחתי להכין תמונה. אפשר לשלוח כטקסט.</p>
        ) : (
          <p className="flex items-center gap-2 p-4 text-sm text-slate-400">
            <Loader2 className="animate-spin" size={16} aria-hidden />
            מכין תמונה...
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={!file}
        onClick={shareImage}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950 disabled:opacity-50"
      >
        <ImageIcon size={20} aria-hidden />
        שליחה כתמונה
      </button>
      <div className="flex gap-2">
        <a
          href={whatsappHref(text)}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/50 text-sm text-emerald-300"
        >
          <MessageCircle size={18} aria-hidden />
          שליחה כטקסט
        </a>
        <button type="button" onClick={copy} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 text-sm text-slate-200">
          <Copy size={18} aria-hidden />
          {copied ? 'הועתק' : 'העתקת טקסט'}
        </button>
      </div>
      <button type="button" onClick={onClose} className="min-h-12 w-full rounded-xl border border-slate-700 text-slate-300">
        סגירה
      </button>
    </Sheet>
  )
}
