import assert from 'assert'
import { filesFromDataTransfer, filesFromInput, isEditableTarget, isFileDrag } from './upload.js'

assert.deepStrictEqual(filesFromDataTransfer(null), [])
assert.deepStrictEqual(filesFromDataTransfer({}), [])

const named = { name: '现场.jpg', type: 'image/jpeg', size: 12, lastModified: 1 }
assert.strictEqual(filesFromDataTransfer({ files: [named] })[0], named)

const shot = { name: 'image.png', type: 'image/png', size: 88, lastModified: 2 }
const duped = filesFromDataTransfer({ files: [shot], items: [{ kind: 'file', getAsFile: () => shot }] })
assert.strictEqual(duped.length, 1, 'files 与 items 同一张图不能收两份')

const png = { name: 'image.png', type: 'image/png', size: 100, lastModified: 3 }
const bmp = { name: 'image.bmp', type: 'image/bmp', size: 200, lastModified: 3 }
const pasted = filesFromDataTransfer({ files: [png, bmp] }, { paste: true })
assert.strictEqual(pasted.length, 1, '粘贴截图只收一张')
assert.ok(/png/i.test(pasted[0].type || pasted[0].name))

const live = { 0: named, length: 1 }
assert.strictEqual(filesFromInput({ files: live }).length, 1)
assert.strictEqual(filesFromInput({ files: live })[0], named)
live.length = 0
delete live[0]
assert.strictEqual(filesFromInput({ files: live }).length, 0, 'input 清空后不能再读原 FileList')

assert.strictEqual(isEditableTarget({ tagName: 'INPUT' }), true)
assert.strictEqual(isEditableTarget({ tagName: 'TEXTAREA' }), true)
assert.strictEqual(isEditableTarget({ tagName: 'DIV', isContentEditable: false, closest: () => null }), false)

assert.strictEqual(isFileDrag({ types: ['Files'] }), true)
assert.strictEqual(isFileDrag({ types: ['text/plain'] }), false)
assert.strictEqual(isFileDrag(null), false)

console.log('upload selfcheck ok')
