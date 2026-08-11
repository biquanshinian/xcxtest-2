/**
 * clip-match 单测（node --test）
 * 覆盖 SciNews 实测写法差：连字符/空格、斜杠型号、罗马数字、同日防串。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeMatchText,
  expandTokenVariants,
  extractFamilyStem,
  softFamilyGroups,
  scoreClipText,
  looksLikeConflictingGroupId,
  parseUploadDateMs,
  pickBestClipCandidate,
  tokenVariantGroups
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

  it('accepts adjacent UTC day in SciNews title', () => {
    const scored = scoreClipText(
      'SpaceX Starlink 412 launch and Falcon 9 first stage landing, 8 August 2026',
      '',
      {
        dateText: '9 August 2026',
        tokens: ['starlink', '17-38'],
        rocketTokens: ['falcon']
      }
    )
    assert.equal(scored.ok, true)
    assert.equal(scored.dateOk, true)
  })

  it('fuzzy-matches Starlink 412 vs LL2 Group 17-38 (different numbering)', () => {
    const scored = scoreClipText(
      'SpaceX Starlink 412 launch and Falcon 9 first stage landing, 8 August 2026',
      'SpaceX Starlink 412 火箭发射以及 Falcon 9 火箭第一级着陆， 2026 年 8 月 8 日',
      {
        dateText: '8 August 2026',
        tokens: ['starlink', '17-38'],
        rocketTokens: ['falcon']
      }
    )
    assert.equal(scored.ok, true)
    assert.equal(scored.strict, false)
    assert.equal(scored.fuzzy, true)
    assert.ok(scored.softHits >= 1)
    assert.ok(scored.rocketHits >= 1)
  })

  it('fuzzy rejects same-day Starlink with conflicting group id in title', () => {
    const scored = scoreClipText(
      'SpaceX Starlink 10 45 launch and Falcon 9 first stage landing, 8 August 2026',
      '',
      {
        dateText: '8 August 2026',
        tokens: ['starlink', '17-38'],
        rocketTokens: ['falcon']
      }
    )
    assert.equal(scored.ok, false)
    assert.equal(scored.fuzzy, false)
  })

  it('fuzzy still requires rocket when rocketTokens present', () => {
    const scored = scoreClipText(
      'SpaceX Starlink 412 launch, 8 August 2026',
      '',
      {
        dateText: '8 August 2026',
        tokens: ['starlink', '17-38'],
        rocketTokens: ['falcon']
      }
    )
    assert.equal(scored.ok, false)
  })

  it('fuzzy uses family stem from numbered-only tokens (Tianlian)', () => {
    assert.equal(extractFamilyStem('tianlian-2-06'), 'tianlian')
    const soft = softFamilyGroups(tokenVariantGroups(['tianlian-2-06']))
    assert.ok(soft.some((g) => g.includes('tianlian')))
    const scored = scoreClipText(
      'Long March-3B launches TianLian-2 07',
      'Launch on 23 July 2026 from Xichang.',
      {
        dateText: '23 July 2026',
        tokens: ['tianlian-2-06'],
        rocketTokens: ['long', 'march', '3b/e']
      }
    )
    assert.equal(scored.ok, true)
    assert.equal(scored.strict, false)
    assert.equal(scored.fuzzy, true)
  })

  it('fuzzy date+rocket when no family stem can be derived', () => {
    const scored = scoreClipText(
      'Falcon 9 launch and landing, 1 January 2026',
      '',
      {
        dateText: '1 January 2026',
        tokens: ['17-38'],
        rocketTokens: ['falcon']
      }
    )
    assert.equal(scored.ok, true)
    assert.equal(scored.fuzzy, true)
  })
})

describe('near-time pick among fuzzy candidates', () => {
  it('parseUploadDateMs reads YYYYMMDD as UTC day start', () => {
    assert.equal(parseUploadDateMs('20260809'), Date.UTC(2026, 7, 9))
    assert.equal(parseUploadDateMs('NA'), 0)
  })

  it('pickBestClipCandidate prefers strict over fuzzy', () => {
    const best = pickBestClipCandidate([
      { scored: { ok: true, strict: false, fuzzy: true, score: 3 }, uploadMs: Date.UTC(2026, 7, 8) },
      { scored: { ok: true, strict: true, fuzzy: false, score: 104 }, uploadMs: Date.UTC(2026, 7, 10) }
    ], Date.UTC(2026, 7, 8, 16, 35))
    assert.equal(best.scored.strict, true)
  })

  it('pickBestClipCandidate picks nearer upload among fuzzy', () => {
    const netMs = Date.UTC(2026, 7, 8, 16, 35) // Starlink Group 17-38 NET (UTC)
    const best = pickBestClipCandidate([
      { id: 'far', scored: { ok: true, strict: false, fuzzy: true, score: 3 }, uploadMs: Date.UTC(2026, 7, 10) },
      { id: 'near', scored: { ok: true, strict: false, fuzzy: true, score: 3 }, uploadMs: Date.UTC(2026, 7, 8) }
    ], netMs)
    assert.equal(best.id, 'near')
  })

  it('looksLikeConflictingGroupId ignores SciNews serial Starlink 412', () => {
    assert.equal(
      looksLikeConflictingGroupId(
        'SpaceX Starlink 412 launch and Falcon 9 first stage landing, 8 August 2026',
        [['17-38']]
      ),
      false
    )
  })
})

describe('compat mp4 helpers', () => {
  // 延迟 import，避免与 clip-match 单测耦合启动副作用
  it('isCompatMp4 accepts h264+aac, rejects vp9', async () => {
    const { isCompatMp4, ytdlpFormatSelector } = await import('./index.js')
    assert.equal(isCompatMp4({ videoCodec: 'h264', audioCodec: 'aac', pixFmt: 'yuv420p' }), true)
    assert.equal(isCompatMp4({ videoCodec: 'h264', audioCodec: '', pixFmt: 'yuv420p' }), true)
    assert.equal(isCompatMp4({ videoCodec: 'vp9', audioCodec: 'aac', pixFmt: 'yuv420p' }), false)
    assert.equal(isCompatMp4({ videoCodec: 'h264', audioCodec: 'opus', pixFmt: 'yuv420p' }), false)
    const fmt = ytdlpFormatSelector(480)
    assert.ok(fmt.includes('[vcodec^=avc]'))
    assert.ok(fmt.startsWith('bv*[height<=480][ext=mp4][vcodec^=avc]'))
  })
})
