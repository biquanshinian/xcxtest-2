import assert from 'assert'
import * as checklist from './checklist.js'
import { canFallbackPhotoUpload, isPayloadTooLarge } from './image-pack.js'
import { fileOcrSource, ocrUploadBatch } from './ocr-files.js'
import { slimMaterialsForCloud } from './project-sync.js'
import { isCloudFileSlot, isDeleteAuthError, isPhotoSlot, PHOTO_SLOTS, photoStoreLabel, pickPhotoSrc, friendlyCloudError } from './photo-slots.js'

assert.deepStrictEqual(PHOTO_SLOTS, ['photo_before', 'photo_during', 'photo_after', 'photo_accept'])
assert.strictEqual(isPhotoSlot('photo_before'), true)
assert.strictEqual(isPhotoSlot('invoices'), false)
assert.strictEqual(isCloudFileSlot('photo_before'), true)
assert.strictEqual(isCloudFileSlot('invoices'), true)
assert.strictEqual(isCloudFileSlot('approval_form'), true)
assert.strictEqual(isCloudFileSlot('contract_watermark'), true)
assert.strictEqual(isCloudFileSlot('../x'), false)
assert.strictEqual(isCloudFileSlot(''), false)
assert.strictEqual(isCloudFileSlot('constructor'), false)
assert.strictEqual(isCloudFileSlot('__proto__'), false)
;['village', 'township', 'small'].forEach((org) => {
  checklist.getItems(org).forEach((item) => {
    assert.ok(isCloudFileSlot(item.id), org + ' 资料项应能存云：' + item.id)
    if (item.special === 'photos') assert.ok(isPhotoSlot(item.id), item.id + ' 应是施工/验收槽')
    else assert.ok(!isPhotoSlot(item.id), item.id + ' 不应占用施工/验收槽')
  })
})
assert.strictEqual(photoStoreLabel({ storing: true }), '保存中')
assert.strictEqual(photoStoreLabel({ cosKey: 'preaudit/2026/p/photo_before/f.jpg' }), '已存云')
assert.strictEqual(photoStoreLabel({ stored: true }), '已存云')
assert.strictEqual(photoStoreLabel({ storeError: '超时' }), '未存上')
assert.strictEqual(photoStoreLabel({ path: 'blob:1' }), '待保存')
assert.strictEqual(pickPhotoSrc({ source: { size: 0 }, path: 'blob:1' }), 'blob:1')
assert.strictEqual(pickPhotoSrc({ source: { size: 12 }, path: 'blob:1' }).size, 12)
assert.strictEqual(fileOcrSource({ source: { size: 12 }, path: 'blob:1' }).size, 12)
assert.strictEqual(fileOcrSource({ path: 'https://x/a.jpg' }), 'https://x/a.jpg')
assert.strictEqual(ocrUploadBatch([]).length, 0)
assert.strictEqual(ocrUploadBatch([{ id: 'a', path: 'a.jpg' }]).length, 1)
const many = [1, 2, 3, 4, 5, 6].map((n) => ({ id: 'f' + n, path: 'p' + n }))
assert.deepStrictEqual(ocrUploadBatch(many).map((f) => f.id), ['f1', 'f2', 'f5', 'f6'])
assert.ok(/项目库还没建好/.test(friendlyCloudError('document.set:fail -502005 database collection not exists. Db or Table not exist: preaudit_projects')))
assert.strictEqual(friendlyCloudError('图太大'), '图太大')

assert.ok(isPayloadTooLarge({ message: 'Exceed max request payload size. For more information, please refer to `https://docs.cloudbase.net/error-code/service/EXCEED_MAX_PAYLOAD_SIZE`' }))
assert.ok(isPayloadTooLarge({ message: '请求负载超过最大限制' }))
assert.ok(isPayloadTooLarge({ code: 413 }))
assert.ok(isPayloadTooLarge({ message: '云函数 JSON 超限，改走直传' }))
assert.ok(!isPayloadTooLarge({ message: '云识别失败 413' }))
assert.ok(!isPayloadTooLarge({ message: '云识别超时' }))
assert.ok(canFallbackPhotoUpload({ message: '未知路由: POST /preaudit/photos/sign' }))
assert.ok(canFallbackPhotoUpload({ message: 'CORS' }))
assert.ok(!canFallbackPhotoUpload({ code: 4000, message: '这项不能存照片' }))
assert.ok(!canFallbackPhotoUpload({ code: 4290, message: '传照片太勤了，过一会儿再试' }))
assert.ok(isDeleteAuthError({ code: 4002, message: '密码不对' }))
assert.ok(isDeleteAuthError({ code: 4010, message: '未授权或登录已过期' }))
assert.ok(isDeleteAuthError({ message: '请输入密码' }))
assert.ok(!isDeleteAuthError({ message: '云端保存超时，请再试一次' }))
assert.ok(!isDeleteAuthError({ message: '未知路由: POST /preaudit/project/destroy' }))
assert.ok(slimMaterialsForCloud({
  invoices: { date: '2026-03-01', confirmed: true, files: [{ id: 'f', path: 'https://x/a.jpg', cosKey: 'preaudit/a.jpg' }] }
}).invoices.confirmed)

console.log('photo-cloud selfcheck ok')
