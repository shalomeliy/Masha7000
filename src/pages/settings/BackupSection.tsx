import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Loader2, RotateCcw, Upload } from 'lucide-react'
import { DriveError } from '../../components/DriveError'
import {
  BACKUP_LISTS,
  BackupError,
  LIST_TITLES,
  MAX_BACKUP_BYTES,
  backupCounts,
  backupDate,
  backupFileName,
  countsText,
  listBackupCopies,
  parseBackup,
  readAll,
  readBackupCopy,
  restoreLists,
  saveCopy,
} from '../../lib/backup'
import type { Backup, BackupList, CopyInfo } from '../../lib/backup'

// Settings > "גיבוי": a file to keep outside the app, copies inside the app's Drive folder, and
// replacing every list with one of them. Restoring is for whoever owns the data (canRestore).

type Restore =
  | { step: 'idle' }
  | { step: 'preview'; backup: Backup }
  | { step: 'running'; backup: Backup; done: BackupList[]; copied: boolean }
  | { step: 'failed'; backup: Backup; done: BackupList[]; copied: boolean; error: unknown }
  | { step: 'restored'; backup: Backup }

const weekday = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { weekday: 'long', timeZone: 'Asia/Jerusalem' })

export function BackupSection({ canRestore }: { canRestore: boolean }) {
  const qc = useQueryClient()
  const copies = useQuery({ queryKey: ['backupCopies'], queryFn: listBackupCopies })
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<unknown>(null)
  const [file, setFile] = useState<{ url: string; name: string } | null>(null)
  const [restore, setRestore] = useState<Restore>({ step: 'idle' })
  const [pickError, setPickError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null) // copy id being read
  const fileInput = useRef<HTMLInputElement>(null)
  const busy = restore.step === 'running'
  const lastWeekly = copies.data?.find((c) => c.kind === 'weekly')

  // Two taps: the first reads Drive, the second saves the file. A phone (Safari above all) only
  // saves a file from a tap, not after waiting for Drive.
  const prepare = async () => {
    setDownloading(true)
    setDownloadError(null)
    try {
      const b = await readAll()
      if (file) URL.revokeObjectURL(file.url)
      setFile({ url: URL.createObjectURL(new Blob([JSON.stringify(b)], { type: 'application/json' })), name: backupFileName() })
    } catch (e) {
      setDownloadError(e)
    } finally {
      setDownloading(false)
    }
  }

  const pickFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '' // the same file can be picked again
    if (!file) return
    setPickError(null)
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new BackupError('הקובץ גדול מדי בשביל להיות גיבוי של האפליקציה.')
      setRestore({ step: 'preview', backup: parseBackup(await file.text()) })
    } catch (e) {
      setPickError(e instanceof BackupError ? e.message : 'לא הצלחנו לקרוא את הקובץ.')
    }
  }

  const openCopy = async (c: CopyInfo) => {
    setPickError(null)
    setOpening(c.id)
    try {
      setRestore({ step: 'preview', backup: await readBackupCopy(c.id) })
    } catch (e) {
      setPickError(e instanceof BackupError ? e.message : 'לא הצלחנו לקרוא את העותק מגוגל דרייב. נסה שוב.')
    } finally {
      setOpening(null)
    }
  }

  const run = async (backup: Backup, doneBefore: BackupList[], copiedBefore: boolean, retry: boolean) => {
    const done = [...doneBefore]
    let copied = copiedBefore
    setRestore({ step: 'running', backup, done, copied })
    try {
      if (!copied) {
        // Today's data first, so even a wrong restore can be undone.
        await saveCopy('beforeRestore')
        copied = true
        void qc.invalidateQueries({ queryKey: ['backupCopies'] })
      }
      await restoreLists(backup, new Set(done), (k) => {
        done.push(k)
        setRestore({ step: 'running', backup, done: [...done], copied })
      }, retry)
      setRestore({ step: 'restored', backup })
    } catch (error) {
      setRestore({ step: 'failed', backup, done, copied, error })
    } finally {
      // Even after a partial restore: the screens must not save their old lists over the restored ones.
      void qc.invalidateQueries({ queryKey: ['drive'] })
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">גיבוי</h2>
      {lastWeekly && <p className="text-sm text-slate-400">גיבוי אוטומטי אחרון: {weekday(lastWeekly.createdAt)} {backupDate(lastWeekly.createdAt)}</p>}

      <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        {file ? (
          <a
            href={file.url}
            download={file.name}
            onClick={() => {
              const url = file.url
              setTimeout(() => {
                URL.revokeObjectURL(url)
                setFile((f) => (f?.url === url ? null : f))
              }, 60_000)
            }}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-slate-950"
          >
            <Download size={18} aria-hidden />
            הקובץ מוכן: לחץ לשמירה
          </a>
        ) : (
          <button
            type="button"
            onClick={prepare}
            disabled={downloading || busy}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 font-semibold text-slate-950 disabled:opacity-50"
          >
            {downloading ? <Loader2 className="animate-spin" size={18} aria-hidden /> : <Download size={18} aria-hidden />}
            {downloading ? 'מכין את הקובץ...' : 'הורדת גיבוי'}
          </button>
        )}
        <p className="text-xs text-slate-400">הקובץ מכיל טלפונים וכתובות של עובדים. שמור אותו במקום פרטי.</p>
        {downloadError !== null && <DriveError error={downloadError} action="load" onRetry={prepare} />}

        {canRestore && (
          <>
            <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 text-slate-200 disabled:opacity-50"
            >
              <Upload size={18} aria-hidden />
              שחזור מגיבוי
            </button>
          </>
        )}
        {pickError && (
          <p role="alert" className="text-sm text-red-400">
            {pickError}
          </p>
        )}
      </div>

      {restore.step !== 'idle' && <RestorePanel restore={restore} onCancel={() => setRestore({ step: 'idle' })} onRun={run} />}

      {canRestore && (
        <div className="space-y-2">
          <h3 className="font-semibold">עותקים אוטומטיים</h3>
          <p className="text-xs text-slate-400">פעם בשבוע האפליקציה שומרת עותק בדרייב, ולפני כל שחזור עוד אחד. נשמרים 8 השבועות האחרונים.</p>
          {copies.isPending ? (
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="animate-spin" size={16} aria-hidden />
              טוען...
            </p>
          ) : copies.isError ? (
            <DriveError error={copies.error} action="load" onRetry={() => copies.refetch()} />
          ) : copies.data.length === 0 ? (
            <p className="text-sm text-slate-500">עוד אין עותקים. הראשון יישמר השבוע.</p>
          ) : (
            <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
              {copies.data.map((c) => (
                <li key={c.id} className="flex min-h-14 items-center gap-2 px-4 py-2">
                  <span className="flex-1 text-sm">
                    <span className="block font-semibold">
                      {backupDate(c.createdAt)}
                      {c.kind === 'beforeRestore' && <span className="font-normal text-amber-300"> · לפני שחזור</span>}
                    </span>
                    <span className="block text-xs text-slate-400">{countsText(c.counts)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => openCopy(c)}
                    disabled={busy || opening !== null}
                    className="flex min-h-11 items-center gap-1 rounded-lg px-3 text-sky-300 disabled:opacity-50"
                  >
                    {opening === c.id ? <Loader2 className="animate-spin" size={16} aria-hidden /> : <RotateCcw size={16} aria-hidden />}
                    שחזור
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function RestorePanel({
  restore,
  onCancel,
  onRun,
}: {
  restore: Exclude<Restore, { step: 'idle' }>
  onCancel: () => void
  onRun: (backup: Backup, done: BackupList[], copied: boolean, retry: boolean) => void
}) {
  const { backup } = restore
  const summary = `גיבוי מ-${backupDate(backup.createdAt)}: ${countsText(backupCounts(backup))}`

  return (
    <div role="region" aria-label="שחזור" className="space-y-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
      <p className="font-semibold">{summary}</p>

      {restore.step === 'preview' && (
        <>
          <p className="text-sm text-slate-300">כל המידע שבאפליקציה היום יוחלף במה שבגיבוי, לכל מי שמחובר. לפני ההחלפה נשמר עותק של המידע של היום, כך שאפשר לחזור אליו.</p>
          <button type="button" onClick={() => onRun(backup, [], false, false)} className="min-h-12 w-full rounded-xl bg-red-600 font-semibold text-white">
            החלף את כל המידע בגיבוי הזה
          </button>
          <button type="button" onClick={onCancel} className="min-h-11 w-full rounded-xl border border-slate-700 text-slate-300">
            ביטול
          </button>
        </>
      )}

      {(restore.step === 'running' || restore.step === 'failed') && (
        <ul className="space-y-1 text-sm">
          <li className={restore.copied ? 'text-emerald-300' : 'text-slate-400'}>{restore.copied ? '✓' : '·'} עותק של המידע של היום</li>
          {BACKUP_LISTS.map((k) => (
            <li key={k} className={restore.done.includes(k) ? 'text-emerald-300' : 'text-slate-400'}>
              {restore.done.includes(k) ? '✓' : '·'} {LIST_TITLES[k]}
            </li>
          ))}
        </ul>
      )}

      {restore.step === 'running' && (
        <p className="flex items-center gap-2 text-sm text-slate-300">
          <Loader2 className="animate-spin" size={16} aria-hidden />
          משחזר... אל תסגור את האפליקציה.
        </p>
      )}

      {restore.step === 'failed' && (
        <>
          <p className="text-sm text-slate-300">
            {restore.done.length > 0 ? `שוחזרו: ${restore.done.map((k) => LIST_TITLES[k]).join(', ')}. השאר עוד לא.` : 'אף רשימה עוד לא שוחזרה.'}
          </p>
          <DriveError error={restore.error} action="save" />
          <button type="button" onClick={() => onRun(backup, restore.done, restore.copied, true)} className="min-h-12 w-full rounded-xl bg-red-600 font-semibold text-white">
            נסה שוב
          </button>
          <button type="button" onClick={onCancel} className="min-h-11 w-full rounded-xl border border-slate-700 text-slate-300">
            סגור
          </button>
        </>
      )}

      {restore.step === 'restored' && (
        <>
          <p role="status" className="text-sm text-emerald-300">
            השחזור הסתיים. כל המידע עכשיו כמו בגיבוי.
          </p>
          <button type="button" onClick={onCancel} className="min-h-11 w-full rounded-xl border border-slate-700 text-slate-300">
            סגור
          </button>
        </>
      )}
    </div>
  )
}
