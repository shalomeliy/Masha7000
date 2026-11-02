// Each open sheet holds one browser history entry, so the phone's Back closes the top sheet
// instead of leaving the app. A sheet closed any other way (Cancel, save, Escape) gives its entry back.

type Entry = { onBack: () => boolean } // true = stay open (a save is in flight)

const stack: Entry[] = []
let ignorePops = 0 // pops we caused ourselves
let toPop = 0 // entries given back, not yet removed from history
let listening = false

function onPop() {
  if (ignorePops > 0) {
    ignorePops--
    return
  }
  const top = stack.pop()
  if (top && top.onBack()) {
    stack.push(top)
    window.history.pushState({ sheet: true }, '')
  }
}

/** Takes a history entry for an opening sheet; returns its release, called when it closes. */
export function holdBack(onBack: () => boolean): () => void {
  if (!listening) {
    window.addEventListener('popstate', onPop)
    listening = true
  }
  const entry: Entry = { onBack }
  stack.push(entry)
  // One sheet closing as another opens (same click): reuse the entry instead of going back and forward.
  if (toPop > 0) toPop--
  else window.history.pushState({ sheet: true }, '')

  return () => {
    const i = stack.indexOf(entry)
    if (i === -1) return // Back already took it
    stack.splice(i, 1)
    toPop++
    // Several sheets closing at once leave as one step back.
    if (toPop === 1)
      queueMicrotask(() => {
        const n = toPop
        toPop = 0
        if (n === 0) return
        ignorePops++
        window.history.go(-n)
      })
  }
}
