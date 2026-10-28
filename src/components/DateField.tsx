import { useState } from 'react'
import { dateError } from '../lib/dates'
import { inputClass } from './Sheet'

// The one date input of the app: a tap opens the calendar; a typed date is checked
// against the calendar on blur. `onChange` reports the value and whether it is valid,
// so the form can refuse to save an impossible date.
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  required,
}: {
  label: string
  value: string
  onChange: (value: string, valid: boolean) => void
  min?: string
  max?: string
  required?: boolean
}) {
  const [error, setError] = useState<string | null>(null)

  const check = (input: HTMLInputElement) => {
    // A half-typed date gives value "" with badInput, which is not the same as an empty field.
    const err = input.validity.badInput ? 'התאריך הזה לא קיים ביומן' : dateError(input.value, { min, max, required })
    setError(err)
    onChange(input.value, err === null)
  }

  return (
    <label className="block space-y-1">
      <span className="text-sm text-slate-300">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker()
          } catch {
            // Older browsers: the native control still opens its own picker.
          }
        }}
        onChange={(e) => check(e.currentTarget)}
        onBlur={(e) => check(e.currentTarget)}
        aria-invalid={error !== null}
        className={`${inputClass} ${error ? 'border-red-500' : ''}`}
      />
      {error && (
        <span role="alert" className="block text-sm text-red-300">
          {error}
        </span>
      )}
    </label>
  )
}
