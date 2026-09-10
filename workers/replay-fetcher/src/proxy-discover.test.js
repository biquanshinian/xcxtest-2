/**
 * proxy-discover 单测（node --test）
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeProxyCandidates, proxyPort, COMMON_LOCAL_PORTS } from './proxy-discover.js'

describe('mergeProxyCandidates', () => {
  it('keeps config first, appends discovered, ends with direct', () => {
    const list = mergeProxyCandidates(
      ['http://127.0.0.1:7897', 'direct'],
      ['http://127.0.0.1:7890', 'socks5://127.0.0.1:7890']
    )
    assert.equal(list[0], 'http://127.0.0.1:7897')
    assert.ok(list.includes('http://127.0.0.1:7890'))
    assert.equal(list[list.length - 1], 'direct')
  })

  it('dedupes case-insensitively and always has direct once', () => {
    const list = mergeProxyCandidates(
      ['http://127.0.0.1:7890', 'DIRECT'],
      ['HTTP://127.0.0.1:7890']
    )
    assert.equal(list.filter((x) => x.toLowerCase() === 'direct').length, 1)
    assert.equal(list.filter((x) => x.toLowerCase() === 'http://127.0.0.1:7890').length, 1)
  })

  it('works with empty config (auto-discover only)', () => {
    const list = mergeProxyCandidates([], ['http://127.0.0.1:7890'])
    assert.deepEqual(list, ['http://127.0.0.1:7890', 'direct'])
  })
})

describe('proxyPort / common ports', () => {
  it('parses port from proxy url', () => {
    assert.equal(proxyPort('http://127.0.0.1:7890'), 7890)
    assert.equal(proxyPort('socks5://127.0.0.1:10808'), 10808)
    assert.equal(proxyPort('direct'), 0)
  })

  it('includes Clash default 7890 and VPNCheap-ish ports', () => {
    assert.ok(COMMON_LOCAL_PORTS.includes(7890))
    assert.ok(COMMON_LOCAL_PORTS.includes(7897))
    assert.ok(COMMON_LOCAL_PORTS.includes(10808))
  })
})
