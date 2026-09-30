/**
 * Pricing regression tests.
 *
 * Run with:  node --test test/pricing.test.js
 * (No dependencies — uses the built-in node:test runner, Node 18+.)
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  costOf,
  isEstimated,
  isGoProvider,
  isPeak,
  unitFor
} from '../lib/pricing.js'

// 2026-09-30 is a Wednesday.
const OFF_PEAK = Date.UTC(2026, 8, 30, 12, 0) // 12:00 UTC -> off-peak
const PEAK = Date.UTC(2026, 8, 30, 2, 0)       // 02:00 UTC -> peak

test('recognises only Zen Go providers', () => {
  assert.equal(isGoProvider('opencode-go'), true)
  assert.equal(isGoProvider('opencode-go-extra'), true)
  assert.equal(isGoProvider('opencode-optimisthub'), true)
  assert.equal(isGoProvider('OpenCode-Go'), true, 'case-insensitive')
  assert.equal(isGoProvider('noxery'), false)
  assert.equal(isGoProvider('deepseek-official'), false)
  assert.equal(isGoProvider(''), false)
})

test('peak window is UTC-based, not shifted', () => {
  assert.equal(isPeak(PEAK), true, '02:00 UTC on a weekday is peak')
  assert.equal(isPeak(OFF_PEAK), false, '12:00 UTC on a weekday is off-peak')
  assert.equal(isPeak(Date.UTC(2026, 8, 30, 1, 0)), true, '01:00 UTC starts peak')
  assert.equal(isPeak(Date.UTC(2026, 8, 30, 4, 0)), false, '04:00 UTC ends peak')
  assert.equal(isPeak(Date.UTC(2026, 8, 30, 7, 0)), true, '07:00 UTC is peak')
  assert.equal(isPeak(Date.UTC(2026, 8, 30, 10, 0)), false, '10:00 UTC ends peak')
})

test('weekends are always off-peak', () => {
  // 2026-10-03 is a Saturday, 2026-10-04 a Sunday.
  assert.equal(isPeak(Date.UTC(2026, 9, 3, 2, 0)), false)
  assert.equal(isPeak(Date.UTC(2026, 9, 4, 2, 0)), false)
})

test('DeepSeek tiers switch between peak and off-peak rates', () => {
  assert.deepEqual(unitFor('opencode-go', 'deepseek-v4.1-flash', OFF_PEAK),
    { cacheHit: 0.003, cacheMiss: 0.15, output: 0.60 })
  assert.deepEqual(unitFor('opencode-go', 'deepseek-v4.1-flash', PEAK),
    { cacheHit: 0.006, cacheMiss: 0.30, output: 1.20 })
  assert.deepEqual(unitFor('opencode-go', 'deepseek-v4-pro', PEAK),
    { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 })
})

test('legacy deepseek-flash id folds into the V4.1 Flash tier', () => {
  assert.deepEqual(
    unitFor('opencode-go', 'deepseek-flash', OFF_PEAK),
    unitFor('opencode-go', 'deepseek-v4.1-flash', OFF_PEAK)
  )
})

test('flat-priced models ignore the clock', () => {
  const a = unitFor('opencode-go', 'mimo-v2.5', OFF_PEAK)
  const b = unitFor('opencode-go', 'mimo-v2.5', PEAK)
  assert.deepEqual(a, b)
  assert.deepEqual(a, { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 })
})

test('free models stay at zero', () => {
  assert.deepEqual(unitFor('opencode-go', 'space-bunny-free', OFF_PEAK),
    { cacheHit: 0, cacheMiss: 0, output: 0 })
  assert.deepEqual(unitFor('opencode-go', 'longcat-2.5-preview-free', OFF_PEAK),
    { cacheHit: 0, cacheMiss: 0, output: 0 })
})

test('union-alpha was free during the stealth window, then paid', () => {
  const before = Date.UTC(2026, 8, 16, 15, 0)
  const after = Date.UTC(2026, 8, 18, 0, 0)
  assert.deepEqual(unitFor('opencode-go', 'union-alpha', before),
    { cacheHit: 0, cacheMiss: 0, output: 0 })
  assert.deepEqual(unitFor('opencode-go', 'union-alpha', after),
    { cacheHit: 0.25, cacheMiss: 2.50, output: 7.50 })
})

test('unknown models return null rather than a guessed price', () => {
  assert.equal(unitFor('opencode-go', 'no-such-model', OFF_PEAK), null)
  assert.equal(unitFor('some-other-provider', 'deepseek-v4.1-flash', OFF_PEAK), null)
})

test('estimated prices are flagged', () => {
  assert.equal(isEstimated('opencode-go', 'omen-alpha'), true)
  assert.equal(isEstimated('opencode-go', 'mimo-v2.5'), false)
  assert.equal(isEstimated('opencode-go', 'deepseek-v4.1-flash'), false)
})

test('cost follows miss/hit/output formula', () => {
  // 1000 miss * 0.15 + 100000 hit * 0.003 + 500 out * 0.60 = 750 / 1e6
  const c = costOf({
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    inputTokens: 1000,
    cacheReadTokens: 100000,
    outputTokens: 500
  }, OFF_PEAK)
  assert.equal(c, 0.00075)
})

test('cost is null for unpriced models, never zero-silently', () => {
  const c = costOf({
    provider: 'opencode-go',
    model: 'no-such-model',
    inputTokens: 1000,
    cacheReadTokens: 0,
    outputTokens: 10
  }, OFF_PEAK)
  assert.equal(c, null)
})

test('missing token fields are treated as zero', () => {
  const c = costOf({ provider: 'opencode-go', model: 'mimo-v2.5' }, OFF_PEAK)
  assert.equal(c, 0)
})
