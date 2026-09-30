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

import { extract } from '../scripts/sync-pricing.mjs'

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
