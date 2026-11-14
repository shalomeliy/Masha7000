// How the app opens on a weak phone connection (Fast 3G, 4x slower CPU), measured in a real browser.
// Usage: node scripts/slow-network.cjs [base-url]   (default https://masha7000.vercel.app)
// Prints, per page: LCP, JavaScript downloaded, and the time until the page is quiet.
// Read-only: it opens public pages only (sign-in and a workers' form), never signs in.
const { chromium } = require('playwright')

const base = process.argv[2] ?? 'https://masha7000.vercel.app'
const pages = [
  ['sign-in', '/'],
  ["workers' constraints form", '/constraints/slowNetworkCheck01'],
  ["workers' details form", '/join/slowNetworkCheck01'],
]

;(async () => {
  const browser = await chromium.launch()
  for (const [name, path] of pages) {
    const runs = []
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      // Chrome DevTools "Fast 3G": 1.6 Mbps down, 750 kbps up, 150 ms round trip (x ~3.75 latency as DevTools applies).
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (750 * 1024) / 8 * 0.9 })
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      let js = 0
      const sizes = new Map()
      cdp.on('Network.responseReceived', (e) => sizes.set(e.requestId, e.response.mimeType))
      cdp.on('Network.loadingFinished', (e) => {
        if ((sizes.get(e.requestId) ?? '').includes('javascript')) js += e.encodedDataLength
      })
      await page.addInitScript(() => {
        window.__lcp = 0
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__lcp = e.startTime
        }).observe({ type: 'largest-contentful-paint', buffered: true })
      })
      const started = Date.now()
      await page.goto(base + path, { waitUntil: 'networkidle', timeout: 120_000 })
      const quiet = Date.now() - started
      await page.mouse.click(5, 5) // LCP stops at the first input
      const lcp = await page.evaluate(() => window.__lcp)
      runs.push({ lcp, js, quiet })
      await context.close()
    }
    const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[1]
    console.log(`${name}: LCP ${(med('lcp') / 1000).toFixed(2)}s, JS ${(med('js') / 1024).toFixed(0)}KB, quiet after ${(med('quiet') / 1000).toFixed(1)}s`)
  }
  await browser.close()
})()
