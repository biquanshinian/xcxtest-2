/**
 * clip-match 单测（node --test）
 * 覆盖 SciNews 实测写法差：连字符/空格、斜杠型号、罗马数字、同日防串。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeMatchText,
  expandTokenVariants,
  scoreClipText
} from './clip-match.js'

describe('normalizeMatchText', () => {
  it('strips separators so TianLian variants collapse', () => {
    assert.equal(normalizeMatchText('Tianlian-2-06'), 'tianlian206')
    assert.equal(normalizeMatchText('TianLian-2 06'), 'tianlian206')
    assert.equal(normalizeMatchText('tianlian 2-06'), 'tianlian206')
  })
})

describe('expandTokenVariants', () => {
  it('expands 3b/e slash variants', () => {
    const g = expandTokenVariants('3b/e')
    assert.ok(g.includes('3b/e'))
    assert.ok(g.includes('3b'))
    assert.ok(g.includes('3be'))
  })

  it('expands roman/arabic suffix', () => {
    assert.ok(expandTokenVariants('vikram-i').includes('vikram-1'))
    assert.ok(expandTokenVariants('vikram-1').includes('vikram-i'))
  })
})

describe('scoreClipText — real SciNews cases', () => {
  it('matches Long March TianLian-2 06 vs LL2 Tianlian-2-06', () => {
    const scored = scoreClipText(
      'Long March-3B launches TianLian-2 06',
      'Launch on 23 July 2026 from Xichang.',
      {
        dateText: '23 July 2026',
        tokens: ['tianlian-2-06'],
        rocketTokens: ['long', 'march', '3b/e']
      }
    )
    assert.equal(scored.ok, true)
    assert.ok(scored.score > 0)
  })

  it('matches Lijian-1 / Kinetica rideshare via satellites token', () => {
    const scored = scoreClipText(
      'Lijian-1 launches 5 satellites',
      'A Lijian-1 launch vehicle on 24 July 2026.',
      {
        dateText: '24 July 2026',
        tokens: ['satellites'],
        rocketTokens: ['kinetica']
      }
    )
    assert.equal(scored.ok, true)
  })

  it('matches Starlink 10-45 with spaced title number', () => {
    const scored = scoreClipText(
      'SpaceX Starlink 10 45 launch and Falcon 9 first stage landing, 14 July 2026',
      '',
      {
        dateText: '14 July 2026',
        tokens: ['starlink', '10-45'],
        rocketTokens: ['falcon']
      }
    )
    assert.equal(scored.ok, true)
  })

  it('rejects wrong mission on same date (no token hit)', () => {
    const scored = scoreClipText(
      'Long March-3B launches TianLian-2 06',
      'on 23 July 2026',
      {
        dateText: '23 July 2026',
        tokens: ['beidou-3', 'g4'],
        rocketTokens: ['long', 'march', '3b']
      }
    )
    assert.equal(scored.ok, false)
  })

  it('rejects missing date', () => {
    const scored = scoreClipText(
      'Long March-3B launches TianLian-2 06',
      'No calendar date here.',
      {
        dateText: '23 July 2026',
        tokens: ['tianlian-2-06'],
        rocketTokens: ['long', 'march', '3b']
      }
    )
    assert.equal(scored.ok, false)
    assert.equal(scored.dateOk, false)
  })

  it('rejects when specific numbered token absent', () => {
    const scored = scoreClipText(
      'Long March-3B launch from Xichang, 23 July 2026',
      '',
      {
        dateText: '23 July 2026',
        tokens: ['tianlian-2-06'],
        rocketTokens: ['long', 'march', '3b']
      }
    )
    assert.equal(scored.ok, false)
  })

  it('rejects empty mission tokens without rocket hit', () => {
    const scored = scoreClipText(
      'Random launch footage',
      'on 1 January 2026',
      {
        dateText: '1 January 2026',
        tokens: [],
        rocketTokens: ['falcon']
      }
    )
    assert.equal(scored.ok, false)
  })

  it('accepts empty mission tokens when rocket hits', () => {
    const scored = scoreClipText(
      'Falcon 9 launch',
      'on 1 January 2026',
      {
        dateText: '1 January 2026',
        tokens: [],
        rocketTokens: ['falcon']
      }
    )
    assert.equal(scored.ok, true)
    assert.ok(scored.rocketHits >= 1)
  })

  it('ignores short pure-digit tokens that would hit year 2026', () => {
    const scored = scoreClipText(
      'Some launch on 23 July 2026',
      '',
      {
        dateText: '23 July 2026',
        tokens: ['06'],
        rocketTokens: []
      }
    )
    assert.equal(scored.ok, false)
  })
})
