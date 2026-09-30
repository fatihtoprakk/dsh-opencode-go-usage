/**
 * Tests for the pricing sync parser.
 *
 * These use a fixture that mirrors the real docs page structure (flat rows,
 * peak/off-peak pairs and context-length tiers) so the parser is covered
 * without hitting the network. A separate live check exists as a manual step:
 * `node scripts/sync-pricing.mjs` diffs against the real page.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  currentLimits,
  diffLimits,
  extract,
  extractLimits,
  renderLimits
} from '../scripts/sync-pricing.mjs'

const row = (...cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`
const table = (...rows) => `<table>${rows.join('')}</table>`

const PRICE_TABLE = table(
  row('Model', 'Input', 'Output', 'Cached Read', 'Cached Write', 'Monthly limit'),
  row('GLM-5.3-Flash', '$0.15', '$0.50', '$0.03', '-', '$60'),
  row('MiMo-V2.5', '$0.14', '$0.28', '$0.0028', '-', '$60'),
  row('LongCat 2.5 Preview Free', '-', '-', '-', '-', '$0'),
  row('Qwen3.7 Plus (&le; 256K tokens)', '$0.40', '$1.60', '$0.04', '$0.50', '$60'),
  row('Qwen3.7 Plus (&gt; 256K tokens)', '$1.20', '$4.80', '$0.12', '$1.50', '$60'),
  row('DeepSeek V4.1 Flash (Off-Peak)', '$0.15', '$0.60', '$0.003', '-', '$60'),
  row('DeepSeek V4.1 Flash (Peak)', '$0.30', '$1.20', '$0.006', '-', '$60')
)

const ID_TABLE = table(
  row('Model', 'Model ID', 'Endpoint', 'AI SDK Package'),
  row('GLM-5.3-Flash', 'glm-5.3-flash', 'https://opencode.ai/zen/go/v1/chat/completions', '@ai-sdk/openai-compatible'),
  row('MiMo-V2.5', 'mimo-v2.5', 'https://opencode.ai/zen/go/v1/chat/completions', '@ai-sdk/openai-compatible'),
  row('Qwen3.7 Plus', 'qwen3.7-plus', 'https://opencode.ai/zen/go/v1/chat/completions', '@ai-sdk/openai-compatible'),
  row('DeepSeek V4.1 Flash', 'deepseek-v4.1-flash', 'https://opencode.ai/zen/go/v1/chat/completions', '@ai-sdk/openai-compatible')
)

const HTML = `<html><body>${PRICE_TABLE}${ID_TABLE}</body></html>`

test('parses flat prices and maps display names to real model ids', () => {
  const out = extract(HTML)
  assert.deepEqual(out.get('glm-5.3-flash'),
    { cacheHit: 0.03, cacheMiss: 0.15, output: 0.5 })
  assert.deepEqual(out.get('mimo-v2.5'),
    { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 })
})

test('free models become explicit zeros, not missing entries', () => {
  const out = extract(HTML)
  // The id table has no row for this one, so it falls back to a slug.
  const free = out.get('longcat-2.5-preview-free')
  assert.deepEqual(free, { cacheHit: 0, cacheMiss: 0, output: 0 })
})

test('folds context-length tiers onto one model id', () => {
  const out = extract(HTML)
  const q = out.get('qwen3.7-plus')
  assert.equal(q.cacheMiss, 0.4, 'base tier')
  assert.equal(q.ctxLimit, 256_000)
  assert.deepEqual(q.ctxOver, { cacheHit: 0.12, cacheMiss: 1.2, output: 4.8 })
})

test('folds peak/off-peak rows onto one model id', () => {
  const out = extract(HTML)
  const d = out.get('deepseek-v4.1-flash')
  assert.deepEqual(d.offPeak, { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 })
  assert.deepEqual(d.peak, { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 })
})

test('recognises the M suffix in a tier threshold', () => {
  const html = `<html><body>${table(
    row('Model', 'Input', 'Output', 'Cached Read', 'Cached Write', 'Monthly limit'),
    row('Test Model (&le; 1M tokens)', '$1.00', '$2.00', '$0.10', '-', '$0'),
    row('Test Model (&gt; 1M tokens)', '$2.00', '$4.00', '$0.20', '-', '$0')
  )}${table(row('Model', 'Model ID'), row('Test Model', 'test-model'))}</body></html>`
  const out = extract(html)
  assert.equal(out.get('test-model').ctxLimit, 1_000_000)
})

test('throws a clear error when the price table is absent', () => {
  assert.throws(() => extract('<html><body><p>no tables here</p></body></html>'),
    /price table not found/)
})

// ── plan allowances ───────────────────────────────────────────────────────

test('extractLimits reads both plan tables and folds tier rows', () => {
  const html = `
    <table><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th><th>Monthly limit</th></tr>
      <tr><td>GLM-5.3-Flash</td><td>$0.15</td><td>$0.50</td><td>$0.03</td><td>-</td><td>$60</td></tr>
      <tr><td>Grok 4.7 (≤ 200K tokens)</td><td>$2</td><td>$6</td><td>$0.5</td><td>-</td><td>$15</td></tr>
    </table>
    <table><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th><th>Monthly limit</th></tr>
      <tr><td>GLM-5.3-Flash</td><td>$0.15</td><td>$0.50</td><td>$0.03</td><td>-</td><td>$180</td></tr>
      <tr><td>Grok 4.7 (≤ 200K tokens)</td><td>$2</td><td>$6</td><td>$0.5</td><td>-</td><td>$60</td></tr>
    </table>
    <table><tr><th>Model</th><th>Model ID</th><th>Endpoint</th><th>AI SDK Package</th></tr>
      <tr><td>GLM-5.3-Flash</td><td>glm-5.3-flash</td><td>/v1</td><td>openai</td></tr>
      <tr><td>Grok 4.7 (≤ 200K tokens)</td><td>grok-4.7</td><td>/v1</td><td>openai</td></tr>
    </table>`
  const out = extractLimits(html)
  assert.deepEqual(out.get('glm-5.3-flash'), { go: 60, plus: 180 })
  assert.deepEqual(out.get('grok-4.7'), { go: 15, plus: 60 })
})

test('an Unlimited allowance becomes null, not a number', () => {
  const html = `
    <table><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th><th>Monthly limit</th></tr>
      <tr><td>Space Bunny Free</td><td>$0</td><td>$0</td><td>$0</td><td>-</td><td>Unlimitedlimited time</td></tr>
    </table>
    <table><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th><th>Monthly limit</th></tr>
      <tr><td>Space Bunny Free</td><td>$0</td><td>$0</td><td>$0</td><td>-</td><td>Unlimitedlimited time</td></tr>
    </table>
    <table><tr><th>Model</th><th>Model ID</th><th>Endpoint</th><th>AI SDK Package</th></tr>
      <tr><td>Space Bunny Free</td><td>space-bunny-free</td><td>/v1</td><td>openai</td></tr>
    </table>`
  assert.deepEqual(extractLimits(html).get('space-bunny-free'), { go: null, plus: null })
})

test('extractLimits throws when a plan table is missing', () => {
  assert.throws(() => extractLimits('<table><tr><th>Model</th></tr></table>'), /limit table/)
})

test('currentLimits and renderLimits round-trip', () => {
  const src = `export const GO_PLAN_LIMITS = {
  'glm-5.3':                     { go:   15, plus:  120 },
  'space-bunny-free':            { go: null, plus: null }
}
`
  const map = currentLimits(src)
  assert.deepEqual(map.get('glm-5.3'), { go: 15, plus: 120 })
  assert.deepEqual(map.get('space-bunny-free'), { go: null, plus: null })

  const rendered = renderLimits(map)
  const back = currentLimits(`export const GO_PLAN_LIMITS = {\n${rendered}\n}\n`)
  assert.deepEqual([...back.entries()].sort(), [...map.entries()].sort())
})

test('diffLimits reports additions, changes and removals', () => {
  const cur = new Map([['a', { go: 1, plus: 2 }], ['gone', { go: 5, plus: 5 }]])
  const rem = new Map([['a', { go: 1, plus: 3 }], ['b', { go: 9, plus: 9 }]])
  const d = diffLimits(cur, rem)
  assert.equal(d.added.length, 1)
  assert.equal(d.added[0][0], 'b')
  assert.equal(d.changed.length, 1)
  assert.equal(d.changed[0][0], 'a')
  assert.equal(d.removed.length, 1)
  assert.equal(d.removed[0][0], 'gone')
  // A model only the source knows about is kept, not silently dropped.
  assert.ok(d.next.has('gone'))
})
