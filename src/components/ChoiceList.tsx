import { Fragment, useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { inputClass } from './Sheet'

// A pick-one list drawn by the app instead of the phone's own <select> list. On Android the phone's
// list puts its round marks on the left even in Hebrew (the owner's report, 2026-11-15); here the mark
// is on the start side: on the right in Hebrew, Arabic and Urdu, on the left in the other languages.
// Every drop-down list in the app uses it.

export type Choice = {
  value: string
  label: string
  group?: string // options with the same group are listed under that heading, after the ones with none
  lang?: string
  dir?: 'rtl' | 'ltr'
}

export function ChoiceList({
  label,
  ariaLabel,
  value,
  options,
  placeholder,
  onChange,
  className = '',
}: {
  label?: string // shown above the button; without it give `ariaLabel`
  ariaLabel?: string
  value: string
  options: Choice[]
  placeholder?: string // on the button while no option has `value` (for "+ add" lists, value is always '')
  onChange: (value: string) => void
  className?: string // extra classes for the button
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const current = options.find((o) => o.value === value)
  const name = label ?? ariaLabel
  const plain = options.filter((o) => !o.group)
  const groups = [...new Set(options.flatMap((o) => (o.group ? [o.group] : [])))]

  const item = (o: Choice) => {
    const on = o.value === value
    return (
      <button
        key={o.value}
        type="button"
        role="option"
        aria-selected={on}
        onClick={() => (setOpen(false), onChange(o.value))}
        className={`flex min-h-12 w-full items-center gap-3 border-b border-slate-800 px-3 py-2 text-start last:border-b-0 ${on ? 'bg-sky-500/10 text-sky-200' : 'text-slate-100'}`}
      >
        <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-sky-400' : 'border-slate-500'}`}>
          {on && <span className="size-2.5 rounded-full bg-sky-400" />}
        </span>
        <span className="min-w-0" lang={o.lang} dir={o.dir}>
          {o.label}
        </span>
      </button>
    )
  }

  return (
    <div className="space-y-1">
      {label && (
        <span id={`${id}-label`} className="block text-sm text-slate-300">
          {label}
        </span>
      )}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label ? undefined : ariaLabel}
        aria-labelledby={label ? `${id}-label ${id}-value` : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`${inputClass} flex items-center justify-between gap-2 text-start ${current ? '' : 'text-slate-300'} ${className}`}
      >
        <span id={`${id}-value`} className="min-w-0 truncate" lang={current?.lang} dir={current?.dir}>
          {current?.label ?? placeholder ?? ''}
        </span>
        <ChevronDown size={18} aria-hidden className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="listbox" aria-label={name} className="max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-slate-700 bg-slate-950">
          {plain.map(item)}
          {groups.map((g) => (
            <Fragment key={g}>
              <div role="presentation" className="border-b border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-400">
                {g}
              </div>
              {options.filter((o) => o.group === g).map(item)}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
