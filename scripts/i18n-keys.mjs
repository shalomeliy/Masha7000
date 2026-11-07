// Lists every Hebrew text the app shows: the first argument of each tx('...') call in src/.
// `node scripts/i18n-keys.mjs` prints them, to find texts a language file is missing.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const unescape = (s) => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c))

export function i18nKeys(root = 'src') {
  const keys = new Set()
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/\btx\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) keys.add(unescape(m[1] ?? m[2]))
      }
    }
  }
  walk(root)
  return [...keys].sort()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keys = i18nKeys()
  for (const k of keys) console.log(JSON.stringify(k))
  console.error(`${keys.length} texts`)
}
