import type { Report, ReportShift, ShiftKind } from './report'

// Draws a report as a PNG card for WhatsApp: a dark header like the app, one white card per shift
// with a color strip for its kind, and every worker with their role. Canvas only, no libraries.
// Laid out twice: once to measure the height, once to draw.

const W = 1080
const PAD = 48
const FONT = 'system-ui, "Segoe UI", Arial, sans-serif'

const KIND_COLOR: Record<ShiftKind, { strip: string; pillBg: string; pillText: string }> = {
  urgent: { strip: '#f59e0b', pillBg: '#fef3c7', pillText: '#92400e' },
  night: { strip: '#6366f1', pillBg: '#e0e7ff', pillText: '#3730a3' },
  day: { strip: '#0ea5e9', pillBg: '#e0f2fe', pillText: '#075985' },
  other: { strip: '#64748b', pillBg: '#f1f5f9', pillText: '#334155' },
}

type Ctx = CanvasRenderingContext2D

const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`

function wrap(c: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && c.measureText(next).width > maxWidth) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  c.fillStyle = fill
  c.beginPath()
  c.roundRect(x, y, w, h, r)
  c.fill()
}

/** Text drawn from the right edge `right`, top at `y`. Returns its width. */
function text(c: Ctx, draw: boolean, value: string, right: number, y: number, f: string, color: string, align: CanvasTextAlign = 'right') {
  c.font = f
  if (draw) {
    c.fillStyle = color
    c.textAlign = align
    c.fillText(value, right, y)
  }
  return c.measureText(value).width
}

/** A rounded label; `edge` is its right side (align right) or left side (align left). Returns its width. */
function pill(c: Ctx, draw: boolean, value: string, edge: number, y: number, size: number, bg: string, color: string, align: 'right' | 'left' = 'right') {
  c.font = font(600, size)
  const w = c.measureText(value).width + size * 1.1
  const h = size * 1.7
  const x = align === 'right' ? edge - w : edge
  if (draw) {
    roundRect(c, x, y, w, h, h / 2, bg)
    c.fillStyle = color
    c.textAlign = 'center'
    c.fillText(value, x + w / 2, y + h / 2)
  }
  return w
}

function shiftCard(c: Ctx, draw: boolean, s: ReportShift, top: number): number {
  const color = KIND_COLOR[s.kind]
  const left = PAD
  const right = W - PAD
  const inR = right - 44 // inner right edge, after the color strip
  const inL = left + 32
  const maxW = inR - inL
  let y = top + 32

  // Measure-then-draw happens at the page level; here the card's background must go first, so
  // the height is computed in a dry run and the card drawn behind the content.
  const body = (d: boolean) => {
    let yy = y
    pill(c, d, s.kindLabel, inR, yy, 30, color.pillBg, color.pillText)
    yy += 30 * 1.7 + 20
    if (s.location) {
      c.font = font(700, 44)
      for (const line of wrap(c, s.location, maxW)) {
        text(c, d, line, inR, yy + 22, font(700, 44), '#0f172a')
        yy += 56
      }
    }
    if (s.until) {
      text(c, d, s.until, inR, yy + 18, font(500, 32), '#b45309')
      yy += 46
    }
    if (s.job) {
      c.font = font(400, 34)
      for (const line of wrap(c, s.job, maxW)) {
        text(c, d, line, inR, yy + 18, font(400, 34), '#475569')
        yy += 46
      }
    }
    yy += 12
    if (d) {
      c.fillStyle = '#e2e8f0'
      c.fillRect(inL, yy, maxW, 2)
    }
    yy += 24
    if (s.crew.length === 0) {
      text(c, d, 'עוד לא שובצו עובדים', inR, yy + 20, font(600, 34), '#b45309')
      yy += 52
    } else {
      text(c, d, `צוות (${s.crew.length})`, inR, yy + 16, font(600, 28), '#64748b')
      yy += 46
      for (const m of s.crew) {
        // Name on the right, role label on the left, like a row in a table.
        text(c, d, m.name, inR, yy + 26, font(700, 38), '#0f172a')
        pill(c, d, m.role, inL, yy, 28, '#f1f5f9', '#334155', 'left')
        yy += 66
      }
    }
    return yy + 16 - top
  }

  const height = body(false)
  if (draw) {
    c.save()
    c.shadowColor = 'rgba(15, 23, 42, 0.08)'
    c.shadowBlur = 24
    c.shadowOffsetY = 6
    roundRect(c, left, top, right - left, height, 28, '#ffffff')
    c.restore()
    c.save()
    c.beginPath()
    c.roundRect(left, top, right - left, height, 28)
    c.clip()
    c.fillStyle = color.strip
    c.fillRect(right - 14, top, 14, height)
    c.restore()
    body(true)
  }
  return height
}

function page(c: Ctx, draw: boolean, report: Report): number {
  const right = W - PAD
  const headH = 230
  if (draw) {
    c.fillStyle = '#f1f5f9'
    c.fillRect(0, 0, W, c.canvas.height)
    c.fillStyle = '#0f172a'
    c.fillRect(0, 0, W, headH)
    c.fillStyle = '#0ea5e9'
    c.fillRect(0, headH - 10, W, 10)
  }
  text(c, draw, report.title, right, 84, font(800, 60), '#ffffff')
  text(c, draw, report.subtitle, right, 160, font(600, 42), '#7dd3fc')
  text(c, draw, 'ShiftSmart', PAD, 84, font(700, 30), '#64748b', 'left')

  let y = headH + 40
  const week = report.days.length > 1
  for (const day of report.days) {
    if (week) {
      text(c, draw, day.title, right, y + 24, font(800, 40), '#0f172a')
      y += 64
    }
    if (day.shifts.length === 0) {
      text(c, draw, 'אין משמרות', right, y + 18, font(500, 32), '#94a3b8')
      y += week ? 64 : 72
      continue
    }
    for (const s of day.shifts) y += shiftCard(c, draw, s, y) + 24
    y += week ? 24 : 0
  }
  text(c, draw, 'נשלח מ-ShiftSmart', W / 2, y + 30, font(500, 26), '#94a3b8', 'center')
  return y + 80
}

export async function reportImage(report: Report): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = 10
  const c = canvas.getContext('2d')!
  const setup = () => {
    c.direction = 'rtl'
    c.textBaseline = 'middle'
  }
  setup()
  canvas.height = Math.ceil(page(c, false, report))
  setup() // resizing the canvas resets its state
  page(c, true, report)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), 'image/png'))
}
