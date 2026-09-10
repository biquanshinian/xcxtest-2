export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return ''
  const num = Number(String(value).replace(/,/g, '').replace(/元/g, '').trim())
  if (isNaN(num)) return ''
  return num.toFixed(2)
}

export function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(String(value).replace(/,/g, '').replace(/元/g, '').trim())
  return isNaN(num) ? null : Math.round(num * 100) / 100
}

export function moneyClose(a, b, yuan) {
  if (a === null || b === null) return null
  const limit = yuan == null ? 1 : yuan
  return Math.abs(a - b) <= limit
}

export function absDiff(a, b) {
  if (a === null || b === null) return null
  return Math.abs(Math.round((a - b) * 100) / 100)
}

export function yearOptions(center) {
  const year = center || new Date().getFullYear()
  const list = []
  for (let i = year - 4; i <= year + 1; i++) list.push(String(i))
  return list
}

export function displayMoney(value) {
  const text = formatMoney(value)
  return text ? text + ' 元' : '—'
}
