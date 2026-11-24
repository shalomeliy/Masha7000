// The phone's model, system and version, guessed for the fault-report form (the manager can fix them).
// The user agent gives a first guess; Chrome on Android hides the model there ("K"), so the
// browser's high-entropy hints fill in the real model and version where it offers them.

export interface DeviceInfo {
  model: string
  os: string
  osVersion: string
}

const dots = (v: string) => v.replace(/_/g, '.')

/** A first guess from the user agent alone. Unknown parts stay empty. */
export function deviceFromUserAgent(ua: string): DeviceInfo {
  let m = ua.match(/Android\s+([\d.]+)(?:;\s*([^;)]+))?/)
  if (m) {
    const model = (m[2] ?? '').replace(/\s+Build\/.*$/, '').trim()
    return { model: model === 'K' || model === 'wv' ? '' : model, os: 'Android', osVersion: m[1] }
  }
  m = ua.match(/(iPhone|iPad|iPod).*?OS\s+([\d_]+)/)
  if (m) return { model: m[1], os: m[1] === 'iPad' ? 'iPadOS' : 'iOS', osVersion: dots(m[2]) }
  m = ua.match(/Windows NT\s+([\d.]+)/)
  if (m) return { model: '', os: 'Windows', osVersion: m[1] === '10.0' ? '10/11' : m[1] }
  m = ua.match(/Mac OS X\s+([\d_.]+)/)
  if (m) return { model: 'Mac', os: 'macOS', osVersion: dots(m[1]) }
  if (/CrOS/.test(ua)) return { model: 'Chromebook', os: 'ChromeOS', osVersion: '' }
  if (/Linux/.test(ua)) return { model: '', os: 'Linux', osVersion: '' }
  return { model: '', os: '', osVersion: '' }
}

interface UaData {
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platform?: string; platformVersion?: string }>
}

/** The best guess on this browser: the user agent, refined by Chrome's hints. Never throws. */
export async function detectDevice(nav: Navigator = navigator): Promise<DeviceInfo> {
  const base = deviceFromUserAgent(nav.userAgent)
  try {
    const data = (nav as Navigator & { userAgentData?: UaData }).userAgentData
    const v = await data?.getHighEntropyValues?.(['model', 'platformVersion'])
    if (!v) return base
    // Windows reports 13 and up for Windows 11.
    const winVersion = v.platformVersion && Number(v.platformVersion.split('.')[0]) >= 13 ? '11' : '10'
    return {
      model: v.model?.trim() || base.model,
      os: base.os || v.platform || '',
      osVersion: base.os === 'Windows' ? winVersion : v.platformVersion?.replace(/(\.0)+$/, '') || base.osVersion,
    }
  } catch {
    return base
  }
}
