import assert from 'assert'
import * as checklist from './checklist.js'
import { normalizeDegrees } from './image-pack.js'
import {
  a4CropInVideo,
  cameraErrorText,
  hasParsedValue,
  mapElementRectToVideo,
  missingRequiredScanFields,
  notifyScanSuccess,
  orientationForAttempt,
  orientationsForScan,
  requiredScanFields,
  SCAN_ORIENTATIONS,
  SCAN_SUCCESS_VIBRATE,
  shouldFinishScan,
  stabilizeParsed,
  unlockScanFeedback
} from './scan-fill.js'

assert.ok(checklist.itemCanScanFill(checklist.getItem('accept_sheet', 'village')))
assert.ok(checklist.itemCanScanFill(checklist.getItem('township_letter', 'township')))
assert.ok(checklist.itemCanScanFill(checklist.getItem('bid_notice', 'village')))
assert.ok(checklist.itemCanScanFill(checklist.getItem('contract', 'village')))
assert.ok(checklist.itemCanScanFill(checklist.getItem('invoices', 'village')))
assert.ok(!checklist.itemCanScanFill(checklist.getItem('photo_before', 'village')))
assert.ok(!checklist.itemCanScanFill(checklist.getItem('photo_accept', 'village')))
assert.ok(!checklist.itemCanScanFill(checklist.getItem('license', 'village')))
assert.ok(checklist.itemCanScanFill(checklist.getItem('compare_sheet', 'small')))
assert.ok(!checklist.itemCanSkipFilesAfterScan(checklist.getItem('compare_sheet', 'small')))
assert.ok(!checklist.itemCanScanFill(checklist.getItem('photo_before', 'small')))
assert.ok(!checklist.getItem('lowest_sheet', 'small'))
assert.ok(!checklist.getItem('photo_accept', 'small'))
assert.ok(!checklist.getItem('accept_sheet', 'small'))
assert.ok(checklist.itemCanSkipFilesAfterScan(checklist.getItem('accept_sheet', 'village')))
assert.ok(!checklist.itemCanSkipFilesAfterScan(checklist.getItem('notice_resolution', 'village')))
assert.ok(!checklist.itemCanSkipFilesAfterScan(checklist.getItem('photo_before', 'village')))

const accept = checklist.getItem('accept_sheet', 'village')
assert.deepStrictEqual(requiredScanFields(accept).sort(), ['amount', 'date'])
assert.deepStrictEqual(missingRequiredScanFields(accept, { date: '', amount: '' }).sort(), ['amount', 'date'])
assert.deepStrictEqual(missingRequiredScanFields(accept, { date: '2026-04-02', amount: '' }), ['amount'])
assert.strictEqual(shouldFinishScan(accept, { date: '2026-04-02', amount: 10000 }, ['金额']), true)
assert.strictEqual(shouldFinishScan(accept, { date: '2026-04-02', amount: '' }, ['日期']), false)
const letter = checklist.getItem('township_letter', 'township')
assert.deepStrictEqual(requiredScanFields(letter).sort(), ['amount', 'date'])
assert.strictEqual(shouldFinishScan(letter, { date: '2026-02-03', amount: '' }, ['日期']), false)
assert.strictEqual(shouldFinishScan(letter, { date: '2026-02-03', amount: 10000 }, ['金额']), true)
const notice = checklist.getItem('notice_resolution', 'village')
assert.ok(missingRequiredScanFields(notice, { startDate: '2026-03-01', endDate: '' }).indexOf('endDate') >= 0)

const plan = checklist.getItem('impl_plan', 'township')
assert.deepStrictEqual(requiredScanFields(plan), [])
assert.strictEqual(shouldFinishScan(plan, { date: '', amount: '' }, []), false)
assert.strictEqual(shouldFinishScan(plan, { date: '2026-02-02', amount: '' }, ['日期']), true)

const memo = Object.create(null)
const first = stabilizeParsed({ date: '2026-04-02', amount: 10000 }, ['date', 'amount'], memo, false)
assert.strictEqual(first.date, '')
assert.strictEqual(first.amount, null)
const second = stabilizeParsed({ date: '2026-04-02', amount: 10000 }, ['date', 'amount'], memo, false)
assert.strictEqual(second.date, '2026-04-02')
assert.strictEqual(second.amount, 10000)
const manual = stabilizeParsed({ date: '2026-03-01', amount: 8 }, ['date', 'amount'], Object.create(null), true)
assert.strictEqual(manual.date, '2026-03-01')
assert.strictEqual(manual.amount, 8)
assert.ok(hasParsedValue(second))
assert.ok(!hasParsedValue({ date: '', amount: null }))

const noticeMemo = Object.create(null)
const noticeScan = stabilizeParsed(
  { date: '2026-04-01', startDate: '', endDate: '' },
  ['startDate', 'endDate'],
  noticeMemo,
  true
)
assert.strictEqual(noticeScan.startDate, '', '公示扫一扫不应把印发日期当成起始日')
assert.strictEqual(noticeScan.endDate, '')

const denied = new Error('Permission denied')
denied.name = 'NotAllowedError'
assert.ok(String(cameraErrorText(denied)).indexOf('摄像头权限') >= 0)

assert.deepStrictEqual(SCAN_SUCCESS_VIBRATE, [30, 40, 55])
assert.strictEqual(notifyScanSuccess(), false, '无窗口时不应抛错')
assert.strictEqual(unlockScanFeedback(), false, '无窗口时不应抛错')

assert.deepStrictEqual(SCAN_ORIENTATIONS, [0, 180, 90, 270])
assert.strictEqual(orientationForAttempt(1), 0)
assert.strictEqual(orientationForAttempt(2), 180)
assert.strictEqual(orientationForAttempt(3), 90)
assert.strictEqual(orientationForAttempt(4), 270)
assert.strictEqual(orientationForAttempt(5), 0)
assert.deepStrictEqual(orientationsForScan(true, 1), [0, 180, 90, 270])
assert.deepStrictEqual(orientationsForScan(false, 1), [0])
assert.deepStrictEqual(orientationsForScan(false, 2), [180])
assert.strictEqual(normalizeDegrees(90), 90)
assert.strictEqual(normalizeDegrees(180), 180)
assert.strictEqual(normalizeDegrees(-90), 270)
assert.strictEqual(normalizeDegrees(360), 0)

const mapped = mapElementRectToVideo(1000, 1000, 1000, 1000, { x: 100, y: 50, w: 200, h: 400 })
assert.deepStrictEqual(mapped, { sx: 100, sy: 50, sw: 200, sh: 400 })
const portrait = a4CropInVideo(1080, 1920, false)
assert.ok(Math.abs(portrait.sw / portrait.sh - 210 / 297) < 0.02)
const landscape = a4CropInVideo(1920, 1080, true)
assert.ok(Math.abs(landscape.sw / landscape.sh - 297 / 210) < 0.02)

console.log('scan-fill selfcheck ok')
