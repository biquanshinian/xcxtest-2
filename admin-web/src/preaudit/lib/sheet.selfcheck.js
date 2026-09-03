import assert from 'assert'
import {
  SHEET_FOOTER,
  SHEET_SLOGAN,
  WORK_PHOTOS_PER_PAGE,
  buildJpegPdf,
  photoSheetCaption,
  sheetPageLabel,
  sheetWorkName,
  sheetMainTitle,
  stagePhotoCode,
  workPageSlice,
  workSheetPageCount
} from './sheet.js'

assert.strictEqual(SHEET_SLOGAN, '先核后报，一次过关')
assert.ok(SHEET_FOOTER.indexOf(SHEET_SLOGAN) >= 0)
assert.ok(SHEET_FOOTER.indexOf('仅供报账彩打') >= 0)
assert.strictEqual(sheetPageLabel(1, 1), '第 1 页 / 共 1 页')
assert.strictEqual(sheetPageLabel(2, 3), '第 2 页 / 共 3 页')
assert.strictEqual(sheetPageLabel(0, 0), '第 1 页 / 共 1 页')
assert.strictEqual(sheetMainTitle('work'), '施工现场照片')
assert.strictEqual(sheetMainTitle('accept'), '现场验收照片')
assert.ok(sheetMainTitle('work').indexOf('分类') < 0)
assert.ok(sheetMainTitle('accept').indexOf('分类') < 0)
assert.strictEqual(sheetWorkName('  村部东侧硬化  '), '村部东侧硬化')
assert.strictEqual(sheetWorkName(''), '')
assert.strictEqual(sheetWorkName('   '), '')
assert.strictEqual(WORK_PHOTOS_PER_PAGE, 3)
assert.strictEqual(stagePhotoCode('施工前', 1), '前-1')
assert.strictEqual(stagePhotoCode('施工中', 4), '中-4')
assert.strictEqual(stagePhotoCode('施工后', 12), '后-12')
assert.strictEqual(stagePhotoCode('现场验收', 2), '验-2')
assert.strictEqual(photoSheetCaption('施工前', 1, '村部东侧硬化'), '前-1  村部东侧硬化')
assert.strictEqual(photoSheetCaption('施工前', 2, '  '), '前-2')
assert.strictEqual(workSheetPageCount([3, 3, 3]), 1)
assert.strictEqual(workSheetPageCount([4, 1, 1]), 2)
assert.strictEqual(workSheetPageCount([7, 2, 4]), 3)
assert.strictEqual(workSheetPageCount([0, 0, 0]), 1)
assert.strictEqual(workSheetPageCount([{ items: [1, 2, 3, 4] }, { items: [1] }, { items: [] }]), 2)
assert.deepStrictEqual(workPageSlice(['a', 'b', 'c', 'd', 'e'], 0), ['a', 'b', 'c'])
assert.deepStrictEqual(workPageSlice(['a', 'b', 'c', 'd', 'e'], 1), ['d', 'e'])
assert.deepStrictEqual(workPageSlice(['a', 'b', 'c'], 0).length, 3)
assert.deepStrictEqual(workPageSlice([1, 2, 3, 4, 5, 6, 7], 2), [7])

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4])
const pdf = buildJpegPdf([
  { width: 1100, height: 1556, bytes: jpeg },
  { width: 1100, height: 1556, bytes: jpeg }
])
const text = Buffer.from(pdf).toString('latin1')
assert.ok(text.indexOf('%PDF-1.4') === 0, '应为 PDF 文件头')
assert.ok(text.indexOf('/Count 2') >= 0, 'PDF 应有 2 页')
assert.ok(text.indexOf('/Type /Page') >= 0)
assert.ok(text.indexOf('%%EOF') >= 0)
assert.throws(() => buildJpegPdf([]), /没有可导出的页面/)

console.log('sheet selfcheck ok')
