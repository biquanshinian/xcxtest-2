#!/usr/bin/env node
/** Patch pages/index/index.js: delegate calendar to subpackage module. */
const fs = require('fs')
const path = require('path')

const indexPath = path.join(__dirname, '..', 'pages/index/index.js')
const lines = fs.readFileSync(indexPath, 'utf8').split(/\r?\n/)

const CALENDAR_HELPER = `
const CALENDAR_PKG = '../../subpackages/index-extra/utils/index-calendar-page.js'
const CALENDAR_METHODS = [
  '_processCalendarMission','getMissionTypeCategory','inferLaunchSiteKey','getMissionStatusCategoryForCalendar',
  'buildCalendarMissionQueryMeta','buildCalendarSiteOptions','getCalendarFilterSummaryText','getMissionMapLinkMeta',
  'buildStarbaseFacilityQuery','buildRoadClosureQuery','getFilteredCalendarMissions','formatMissionTime',
  'buildCalendarSummaryStats','buildCalendarMonthStats','buildCalendarDateMapFromMissions','updateCalendarSummaryOverflowHint',
  'buildCalendarDerivedPayload','updateCalendarDerivedState','applyCalendarBatchState','restoreCalendarCacheSnapshot',
  'fetchCalendarMissionPage','fetchCalendarMissionBatch','resetCalendarLoadFailureState','finishCalendarAppendWithoutChanges',
  'applyCalendarMissionSnapshot','_refreshLaunchCalendarDot','hydrateCalendarFromLoadedMissionLists','syncCalendarFromMissionListsIfNeeded',
  'loadCalendarData','_continueLoadCalendarDataAfterCacheMiss','_loadMoreCalendarData','_saveCalendarCache','_isMonthCovered',
  'buildCalendarDayCells','shouldAutoLoadMoreCalendarMonth','buildCalendarDays','switchCalendarMonth','calendarPrevMonth',
  'calendarNextMonth','calendarGoToday','onCalendarMonthTitleTap','onCalendarMonthPickerChange','onCalendarDateTap',
  'toggleCalendarFilterPanel','applyCalendarFilterState','onCalendarQuickFilterTap','onCalendarSiteFilterTap',
  'onCalendarStatusFilterTap','resetCalendarFilters','buildMapEntryList','openCalendarMapLink','onCalendarSwipeStart',
  'onCalendarSwipeEnd','_patchCalendarMissionRocketImage'
]
function delegateCalendar(name) {
  return function (...args) {
    const page = this
    if (page.__calendarAttached) return page[name](...args)
    if (!page.__calendarLoadPromise) {
      page.__calendarLoadPromise = require.async(CALENDAR_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      })
    }
    return page.__calendarLoadPromise.then(() => page[name](...args))
  }
}
const calendarDelegates = {}
CALENDAR_METHODS.forEach((name) => { calendarDelegates[name] = delegateCalendar(name) })
`.trimEnd()

const DELETE_RANGES = [[2219, 2236], [2407, 3350], [3834, 3849]]

function removeRanges(srcLines, ranges) {
  const drop = new Set()
  for (const [a, b] of ranges) {
    for (let i = a; i <= b; i++) drop.add(i)
  }
  return srcLines.filter((_, i) => !drop.has(i))
}

function stripCalendarRequires(srcLines) {
  return srcLines.map((line) => {
    if (line.includes('CALENDAR_PAGE_LIMIT,')) return null
    if (line.includes('getValidCalendarCache,')) return null
    if (line.includes('buildCalendarMissionBatch')) return null
    if (line.includes('shouldHydrateCalendarFromMissionLists,')) return null
    if (line.includes('buildCalendarExpandedState,')) return null
    if (line.includes('buildCalendarSummaryFallback,')) return null
    if (line.includes('buildCalendarDerivedSetData,')) return null
    return line
  }).filter((line) => line !== null)
}

let next = removeRanges(lines, DELETE_RANGES.sort((a, b) => b[0] - a[0]))
next = stripCalendarRequires(next)

const insertAfter = next.findIndex((line) => line.includes("require('../../utils/upcoming-agency-filter.js')"))
if (insertAfter < 0) {
  console.error('Could not find upcoming-agency-filter require')
  process.exit(1)
}

next.splice(insertAfter + 1, 0, CALENDAR_HELPER)

const pageIdx = next.findIndex((line) => /^Page\(\{$/.test(line))
if (pageIdx < 0) {
  console.error('Could not find Page({')
  process.exit(1)
}
next.splice(pageIdx + 1, 0, '  ...calendarDelegates,')

fs.writeFileSync(indexPath, next.join('\n'), 'utf8')
console.log('Patched', indexPath)
console.log('Removed lines:', DELETE_RANGES.map(([a, b]) => `${a}-${b}`).join(', '))
console.log('Inserted calendar helper after line', insertAfter + 1)
console.log('Added ...calendarDelegates, after Page({ at line', pageIdx + 1)
