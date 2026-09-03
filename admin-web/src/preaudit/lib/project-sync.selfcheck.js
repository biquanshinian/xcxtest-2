import assert from 'assert'
import {
  applyCloudMaterials,
  applyCloudScalars,
  cloudRecordIsNewer,
  fileFromCloud,
  hasCloudSyncedFile,
  hasIncomingCloudFiles,
  mergeCloudFiles,
  slimCloudFile,
  slimMaterialsForCloud,
  wasCloudSynced
} from './project-sync.js'

assert.strictEqual(slimCloudFile({ id: 'f1', path: 'blob:abc' }), null)
assert.ok(slimCloudFile({ id: 'f1', path: 'https://x/a.jpg', cosKey: 'preaudit/2026/p/invoices/f1.jpg' }))
assert.strictEqual(fileFromCloud({ id: 'f1', path: 'blob:abc' }), null)
assert.strictEqual(fileFromCloud({ id: 'f1', url: 'https://x/a.jpg', key: 'preaudit/a.jpg' }).path, 'https://x/a.jpg')

const slim = slimMaterialsForCloud({
  invoices: {
    date: '2026-03-01',
    amount: 1200,
    confirmed: true,
    files: [
      { id: 'local', path: 'blob:1' },
      { id: 'cloud', path: 'https://x/a.jpg', cosKey: 'preaudit/2026/p/invoices/cloud.jpg', ocrText: '价税合计壹仟贰佰元', caption: '发票' }
    ]
  },
  constructor: { date: 'x' },
  photo_before: { date: '2026-02-01', files: [] }
})
assert.ok(slim.invoices)
assert.ok(slim.photo_before)
assert.ok(!Object.prototype.hasOwnProperty.call(slim, 'constructor'))
assert.strictEqual(slim.invoices.files.length, 1)
assert.strictEqual(slim.invoices.files[0].id, 'cloud')
assert.strictEqual(slim.invoices.confirmed, true)
assert.ok(String(slim.invoices.files[0].ocrText).indexOf('价税合计') >= 0)

const localFiles = [
  { id: 'pending', path: 'blob:2' },
  { id: 'old', path: 'https://x/old.jpg', cosKey: 'preaudit/old.jpg', caption: '本机' }
]
const cloudFiles = [
  { id: 'new', url: 'https://x/new.jpg', key: 'preaudit/new.jpg', caption: '云端' }
]
const preferCloud = mergeCloudFiles(localFiles, cloudFiles, true)
assert.deepStrictEqual(preferCloud.map((f) => f.id), ['new', 'pending'])
const preferLocal = mergeCloudFiles(localFiles, cloudFiles, false)
assert.deepStrictEqual(preferLocal.map((f) => f.id), ['pending', 'old', 'new'])

const local = {
  id: 'p1',
  updatedAt: 10,
  village: '本机村',
  contractor: '',
  materials: {
    invoices: { date: '2026-01-01', amount: 1, confirmed: false, files: [] }
  }
}
applyCloudScalars(local, { village: '云端村', contractor: '云公司', bidAmount: 8800, jointBid: true }, true)
assert.strictEqual(local.village, '云端村')
assert.strictEqual(local.contractor, '云公司')
assert.strictEqual(local.bidAmount, 8800)
assert.strictEqual(local.jointBid, true)

applyCloudMaterials(local, {
  invoices: { date: '2026-04-02', amount: 3300, confirmed: true, files: [{ id: 'inv', url: 'https://x/i.jpg', key: 'preaudit/i.jpg' }] }
}, true)
assert.strictEqual(local.materials.invoices.date, '2026-04-02')
assert.strictEqual(local.materials.invoices.amount, 3300)
assert.strictEqual(local.materials.invoices.confirmed, true)
assert.strictEqual(local.materials.invoices.files[0].id, 'inv')

const older = { updatedAt: 20 }
assert.strictEqual(cloudRecordIsNewer(older, { updatedAt: 10 }), false)
assert.strictEqual(cloudRecordIsNewer(older, { updatedAt: 20 }), true)
assert.strictEqual(cloudRecordIsNewer(null, { updatedAt: 1 }), true)

assert.strictEqual(hasCloudSyncedFile({ materials: { invoices: { files: [{ path: 'blob:1' }] } } }), false)
assert.strictEqual(hasCloudSyncedFile({ materials: { invoices: { files: [{ path: 'https://x/a.jpg' }] } } }), true)
assert.strictEqual(wasCloudSynced({ cloudSyncedAt: 1 }), true)
assert.strictEqual(wasCloudSynced({ materials: {} }), false)
assert.strictEqual(hasIncomingCloudFiles(
  { materials: { invoices: { files: [{ id: 'a' }] } } },
  { materials: { invoices: { files: [{ id: 'a' }, { id: 'b' }] } } }
), true)
assert.strictEqual(hasIncomingCloudFiles(
  { materials: { invoices: { files: [{ id: 'a' }] } } },
  { photos: { photo_before: [{ id: 'a' }] }, materials: { invoices: { files: [{ id: 'a' }] } } }
), false)

console.log('project-sync selfcheck ok')
