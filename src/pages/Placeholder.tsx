export function Placeholder({ title }: { title: string }) {
  return (
    <section className="px-4 pt-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-slate-400">המסך הזה ייבנה בגרסה הבאה.</p>
    </section>
  )
}
