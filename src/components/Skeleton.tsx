import { tx } from '../i18n'

// Grey shapes where the content will be, so the screen does not jump when it arrives.

const bar = 'animate-pulse rounded-xl bg-slate-800 motion-reduce:animate-none'

/** While a screen's code downloads (the first time it is opened). */
export function ScreenLoading() {
  return (
    <section className="space-y-4 px-4 pt-6" aria-busy="true" aria-label={tx('טוען...')}>
      <div className={`${bar} h-8 w-40`} />
      <div className={`${bar} h-14`} />
      <div className={`${bar} h-24`} />
      <div className={`${bar} h-24`} />
    </section>
  )
}

/** The calendar while its lists come from Drive: the two buttons and a few days of jobs. */
export function CalendarSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" role="status" aria-label={tx('טוען מגוגל דרייב...')}>
      <div className="grid grid-cols-2 gap-2">
        <div className={`${bar} h-14`} />
        <div className={`${bar} h-14`} />
      </div>
      <div className={`${bar} h-12`} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <div className={`${bar} h-5 w-28`} />
          <div className={`${bar} h-20`} />
        </div>
      ))}
    </div>
  )
}
