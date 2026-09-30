/**
 * dsh-opencode-go-usage — price table (PURE MODULE, no side effects, testable).
 *
 * Design decision: prices are USD and stay USD.
 *
 * Why this plugin exists: the popular `dsh-usage-plugin` is hard-wired to the
 * official DeepSeek CNY tariff. Its `costFor()` ends with
 * `if (provider !== 'deepseek-official') return 0`, so calls routed through
 * OpenCode Zen Go are priced at zero and the UI shows ¥0.0000. This module
 * puts the provider back into the calculation and never converts currency.
 *
 * Source: https://opencode.ai/docs/go/ — verified 2026-09-30.
 * Re-check that page before trusting these numbers; list prices change.
 */

/** Zen Go list prices — USD per 1M tokens: { cacheHit, cacheMiss, output }. */
export const GO_PRICING = {
  'glm-5.3-flash':              { cacheHit: 0.03,     cacheMiss: 0.15,  output: 0.50 },
  'glm-5.3':                    { cacheHit: 0.26,     cacheMiss: 1.40,  output: 4.40 },
  'glm-5.2':                    { cacheHit: 0.26,     cacheMiss: 1.40,  output: 4.40 },
  'kimi-k3':                    { cacheHit: 0.30,     cacheMiss: 3.00,  output: 15.00 },
  'kimi-k2.7-code':             { cacheHit: 0.19,     cacheMiss: 0.95,  output: 4.00 },
  'kimi-k2.6':                  { cacheHit: 0.16,     cacheMiss: 0.95,  output: 4.00 },
  'longcat-2.0':                { cacheHit: 0.006,    cacheMiss: 0.30,  output: 1.20 },
  'longcat-2.5-preview-free':   { cacheHit: 0,        cacheMiss: 0,     output: 0 },
  'mimo-v2.6-flash':            { cacheHit: 0.0028,   cacheMiss: 0.14,  output: 0.28 },
  'mimo-v2.6-pro':              { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
  'mimo-v2.5':                  { cacheHit: 0.0028,   cacheMiss: 0.14,  output: 0.28 },
  'mimo-v2.5-pro':              { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
  'minimax-m3':                 { cacheHit: 0.06,     cacheMiss: 0.30,  output: 1.20 },
  'minimax-m2.7':               { cacheHit: 0.06,     cacheMiss: 0.30,  output: 1.20 },
  'muse-spark-1.3-contributor': { cacheHit: 0.002,    cacheMiss: 0.10,  output: 0.20 },
  'muse-spark-1.2-contributor': { cacheHit: 0.002,    cacheMiss: 0.10,  output: 0.20 },
  'qwen3.8-max':                { cacheHit: 0.25,     cacheMiss: 2.00,  output: 6.00 },
  'qwen3.8-flash':              { cacheHit: 0.016,    cacheMiss: 0.15,  output: 0.47 },
  'qwen3.7-plus':               { cacheHit: 0.04,     cacheMiss: 0.40,  output: 1.60 },
  'hy4-preview':                { cacheHit: 0.042,    cacheMiss: 0.834, output: 2.501 },
  'hy3':                        { cacheHit: 0.035,    cacheMiss: 0.14,  output: 0.58 },
  'space-bunny-free':           { cacheHit: 0,        cacheMiss: 0,     output: 0 },
  'grok-4.7':                   { cacheHit: 0.50,     cacheMiss: 2.00,  output: 6.00 },
  'grok-4.6':                   { cacheHit: 0.50,     cacheMiss: 2.00,  output: 6.00 },
  'gpt-6-luna':                 { cacheHit: 0.01,     cacheMiss: 0.10,  output: 0.50 },
  'gpt-5.6-luna':               { cacheHit: 0.02,     cacheMiss: 0.20,  output: 1.20 },

  // ── stealth / unnamed models ────────────────────────────────────────
  // NOT on the official price list. The values below are ESTIMATES and are
  // flagged as such in the UI (`estimated: true`), so totals can show their
  // uncertainty instead of pretending to be exact.
  //   omen-alpha : OpenCode quotes ~11,600 requests / 5h. That economics
  //                matches the GLM-5.3-Flash tier, which is what we use.
  //                In practice this single assumption swings the total by
  //                an order of magnitude — verify against your real bill.
  //   union-alpha: unbiased/pareto. Free during the stealth window; paid
  //                ($2.50 / $0.25 / $7.50) from 2026-09-17 23:24 UTC.
  'omen-alpha':                 { cacheHit: 0.06,     cacheMiss: 0.30,  output: 1.20, estimated: true },
  'union-alpha':                { cacheHit: 0.25,     cacheMiss: 2.50,  output: 7.50 }
}

/** Instant Union Alpha switched from free to paid (ms). */
export const UNION_ALPHA_PAID_AT = Date.UTC(2026, 8, 17, 23, 24)

/**
 * DeepSeek models served through Zen Go are peak/off-peak.
 *
 * The official definition is UTC-based: weekdays 01:00-04:00 and 06:00-10:00
 * UTC are PEAK. Every other hour, plus the whole weekend, is OFF-PEAK.
 *
 * Note: do NOT shift the timestamp before reading the hours. One upstream
 * implementation got this wrong (shifted +8h, then read UTC hours, so a
 * genuine 02:00 UTC peak call was billed at the off-peak rate). Keep it UTC.
 */
export const GO_DEEPSEEK = {
  'deepseek-v4.1-flash': {
    offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.60 },
    peak:    { cacheHit: 0.006, cacheMiss: 0.30, output: 1.20 }
  },
  'deepseek-v4-flash': {
    offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.60 },
    peak:    { cacheHit: 0.006, cacheMiss: 0.30, output: 1.20 }
  },
  'deepseek-v4-flash-vision-exp': {
    offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.60 },
    peak:    { cacheHit: 0.006, cacheMiss: 0.30, output: 1.20 }
  },
  'deepseek-v4-pro': {
    offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
    peak:    { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 }
  }
}

/** Legacy id -> current tier. "deepseek-flash" folds into V4.1 Flash. */
export const GO_ALIAS = { 'deepseek-flash': 'deepseek-v4.1-flash' }

/**
 * Providers billed through OpenCode Zen Go.
 * All of these resolve to the same endpoint (https://opencode.ai/zen/go/v1),
 * so they share one price table. Add your own id here if you route elsewhere.
 */
export const GO_PROVIDERS = new Set([
  'opencode-go', 'opencode-go-extra',
  'opencode-optimisthub', 'opencode-optimsithub'
])

/** UTC-based peak detection. Weekends are always off-peak. */
export function isPeak(ts) {
  const d = new Date(ts)
  const day = d.getUTCDay()
  if (day === 0 || day === 6) return false
  const h = d.getUTCHours()
  return (h >= 1 && h < 4) || (h >= 6 && h < 10)
}

/** Is this provider billed through Zen Go? */
export function isGoProvider(provider) {
  return GO_PROVIDERS.has(String(provider || '').trim().toLowerCase())
}

/**
 * Unit prices for one call.
 * @returns {{cacheHit:number,cacheMiss:number,output:number,estimated?:boolean}|null}
 *          null when the model is unknown (never guess a nearby price).
 */
export function unitFor(provider, model, ts) {
  if (!isGoProvider(provider)) return null
  let m = String(model || '').trim().toLowerCase()
  m = GO_ALIAS[m] || m

  if (m === 'union-alpha') {
    // Free for the duration of the stealth window.
    if (ts < UNION_ALPHA_PAID_AT) return { cacheHit: 0, cacheMiss: 0, output: 0 }
    return { cacheHit: 0.25, cacheMiss: 2.50, output: 7.50 }
  }
  const dv = GO_DEEPSEEK[m]
  if (dv) return isPeak(ts) ? dv.peak : dv.offPeak
  return GO_PRICING[m] || null
}

/**
 * Official formula: cacheMiss*miss + cacheHit*hit + output*out  (USD).
 *
 * DeepSeek never reports cache_write, and cache writes are billed at the miss
 * rate — so there is deliberately no separate cache-write bucket. Adding one
 * would double-count token volume.
 */
export function costOf(rec, ts) {
  const u = unitFor(rec.provider, rec.model, ts)
  if (!u) return null
  const hit = rec.cacheReadTokens || 0
  const miss = rec.inputTokens || 0
  const out = rec.outputTokens || 0
  return (miss * u.cacheMiss + hit * u.cacheHit + out * u.output) / 1e6
}

/** Is this an estimated (stealth-model) price? */
export function isEstimated(provider, model) {
  const raw = String(model || '').trim().toLowerCase()
  const m = GO_ALIAS[raw] || raw
  const u = GO_PRICING[m]
  return !!(u && u.estimated)
}
