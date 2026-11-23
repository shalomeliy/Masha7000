// Watches the app's start, outside the app's own code (2026-11-23: the iPhone home-screen app opened to
// a blank white screen and nothing reached Sentry). If nothing was drawn after 8 seconds, it shows why
// it knows of, and a button that clears this phone's stored copy of the app and loads it fresh.
// Plain script, no modules, so it runs even when the app's own files fail to load or to start.
;(function () {
  var errors = []
  window.addEventListener('error', function (e) {
    errors.push('error: ' + (e.message || (e.target && (e.target.src || e.target.href)) || 'unknown') + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : ''))
  }, true)
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason
    errors.push('rejection: ' + (r && (r.stack || r.message) ? String(r.message) + ' ' + String(r.stack || '').slice(0, 300) : String(r)))
  })

  function clearAndReload() {
    var jobs = []
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
        return Promise.all(rs.map(function (r) { return r.unregister() }))
      }))
    }
    if (window.caches && caches.keys) {
      jobs.push(caches.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) { return caches.delete(k) }))
      }))
    }
    Promise.all(jobs).catch(function () {}).then(function () { location.reload() })
  }

  setTimeout(function () {
    var root = document.getElementById('root')
    if (!root || root.childElementCount > 0) return
    var info = [
      'standalone: ' + (navigator.standalone === true),
      'sw controller: ' + Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
      'online: ' + navigator.onLine,
      'ua: ' + navigator.userAgent,
    ].concat(errors.length ? errors : ['no errors caught'])
    var box = document.createElement('div')
    box.setAttribute('dir', 'rtl')
    box.style.cssText = 'background:#020617;color:#e2e8f0;min-height:100vh;padding:48px 16px 16px;font:15px system-ui,sans-serif'
    var h = document.createElement('p')
    // Outside the app, so no translations: Hebrew and English together.
    h.textContent = 'האפליקציה לא נטענה. אפשר לנקות את העותק השמור בטלפון ולטעון מחדש. המידע למטה עוזר למצוא את הסיבה. / The app did not load. Clear and reload; the details below help find why.'
    var b = document.createElement('button')
    b.textContent = 'נקה וטען מחדש / Clear and reload'
    b.style.cssText = 'margin:12px 0;min-height:44px;padding:0 16px;border-radius:12px;border:0;background:#0284c7;color:#fff;font-weight:600'
    b.onclick = clearAndReload
    var pre = document.createElement('pre')
    pre.setAttribute('dir', 'ltr')
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;font-size:12px;background:#0f172a;padding:12px;border-radius:12px'
    pre.textContent = info.join('\n')
    box.appendChild(h)
    box.appendChild(b)
    box.appendChild(pre)
    document.body.appendChild(box)
  }, 8000)
})()
