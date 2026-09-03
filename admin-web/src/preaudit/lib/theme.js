const KEY = 'preaudit-theme'

export function readPreauditTheme() {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch (e) {
    return 'light'
  }
}

export function syncPreauditThemeClass(mode) {
  if (typeof document === 'undefined') return
  const theme = mode === 'dark' ? 'dark' : 'light'
  document.documentElement.setAttribute('data-pa-theme', theme)
}

export function clearPreauditThemeClass() {
  if (typeof document === 'undefined') return
  document.documentElement.removeAttribute('data-pa-theme')
}

export function writePreauditTheme(mode) {
  const theme = mode === 'dark' ? 'dark' : 'light'
  try { localStorage.setItem(KEY, theme) } catch (e) { /* ignore */ }
  syncPreauditThemeClass(theme)
  return theme
}

export function togglePreauditTheme(current) {
  return writePreauditTheme(current === 'dark' ? 'light' : 'dark')
}
