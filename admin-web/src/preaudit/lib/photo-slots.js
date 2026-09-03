export const PHOTO_SLOTS = ['photo_before', 'photo_during', 'photo_after', 'photo_accept']

export function isPhotoSlot(itemId) {
  return PHOTO_SLOTS.indexOf(itemId) >= 0
}

export function isCloudFileSlot(itemId) {
  const id = String(itemId || '')
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(id)) return false
  if (Object.prototype.hasOwnProperty.call(Object.prototype, id)) return false
  return true
}

export function photoStoreLabel(file) {
  if (!file) return ''
  if (file.storing) return '保存中'
  if (file.cosKey || file.stored) return '已存云'
  if (file.storeError) return '未存上'
  return '待保存'
}

export function pickPhotoSrc(file) {
  if (!file) return ''
  if (file.source && Number(file.source.size) > 0) return file.source
  return file.path || ''
}

export function isDeleteAuthError(err) {
  const code = err && err.code
  if (code === 4002 || code === 4010 || code === '4002' || code === '4010') return true
  const msg = String((err && err.message) || '')
  return /密码不对|请输入密码|未授权|登录已过期/.test(msg)
}

export function friendlyCloudError(message) {
  const s = String(message || '')
  if (/502005|collection not exists|Db or Table not exist|preaudit_projects/i.test(s)) {
    return '云端项目库还没建好，已自动补建，请再点一次未存上'
  }
  return s
}
