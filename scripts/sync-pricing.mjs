#!/usr/bin/env node
/**
 * Sync the price table from the official OpenCode Zen Go docs page.
 *
 * Why this exists: list prices change. Hand-copying them into lib/pricing.js
 * means the plugin silently drifts and starts reporting wrong money. This
 * script fetches the live table, diffs it against what we ship, and rewrites
 * the generated block in lib/pricing.js.
 *
 *   node scripts/sync-pricing.mjs           # report the diff, change nothing
 *   node scripts/sync-pricing.mjs --write   # apply the diff
 *
 * Design notes:
 *  - Prices are NOT fetched at runtime. A DSH plugin doing network I/O on
 *    startup is slower, fails offline, and would make past costs move when a
 *    price changes. The table stays baked in; this script refreshes it.
 *  - Data is read from the docs HTML. There is no JSON price API (verified:
 *    /api/pricing and /pricing.json are 404, and /zen/go/v1/models returns
 *    model ids with no prices). If OpenCode ever ships one, swap fetchPage().
 *  - Hand-maintained entries (stealth models) are preserved and never
 *    overwritten, because they have no official price by definition.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PRICING_JS = join(HERE, '..', 'lib', 'pricing.js')
const SOURCE_URL = 'https://opencode.ai/docs/go/'

// ── page fetch + parsing ────────────────────────────────────────────────

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'dsh-opencode-go-usage pricing sync (+https://github.com/fatihtoprakk/dsh-opencode-go-usage)' }
  })
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`)
  return res.text()
}

/** Strip tags and decode the handful of entities the page actually uses. */
function text(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&le;/g, '\u2264')   // ≤ — the tier separator on the docs page
    .replace(/&ge;/g, '\u2265')   // ≥
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/** Parse "$1.40" -> 1.4; "-" or blank -> null. */
function price(raw) {
  const m = /\$\s*([0-9]+(?:\.[0-9]+)?)/.exec(raw)
  return m ? Number(m[1]) : null
}

function tables(html) {
  return html.match(/<table[\s\S]*?<\/table>/g) || []
}

function rowsOf(table) {
  return (table.match(/<tr[\s\S]*?<\/tr>/g) || []).map((tr) =>
    (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).map(text)
  )
}

/** Find the table whose header starts with Model and includes an Input column. */
function findPriceTable(html) {
  for (const t of tables(html)) {
    const rows = rowsOf(t)
    if (!rows.length) continue
    const head = rows[0]
    if (head[0] === 'Model' && head.includes('Input') && head.includes('Cached Read')) {
      return rows
    }
  }
  throw new Error('price table not found — the docs page layout probably changed')
}

/** Find the "Model | Model ID | Endpoint" table that maps display names to ids. */
function findIdMap(html) {
  for (const t of tables(html)) {
    const rows = rowsOf(t)
    if (!rows.length) continue
    if (rows[0][0] === 'Model' && rows[0].includes('Model ID')) {
      const map = {}
      for (const r of rows.slice(1)) {
        if (r.length >= 2 && r[0] && r[1]) map[r[0]] = r[1]
      }
      return map
    }
  }
  return {}
}

/**
 * Extract every priced model.
 *
 * Three row shapes appear on the page:
 *   1. flat       "GLM-5.3-Flash"                  -> one price
 *   2. peak split "DeepSeek V4.1 Flash (Off-Peak)" -> offPeak/peak pair
 *   3. ctx tiers  "Grok 4.7 (≤ 200K tokens)"       -> base price below the
 *                 "Grok 4.7 (> 200K tokens)"          threshold, higher above
 *
 * Tiers are folded onto the real model id (both rows map to `grok-4.7`) and
 * stored as { ctxLimit, ctxOver }. Missing that second tier means silently
 * under-reporting long-context calls by 2x, which is exactly the bug this
 * script exists to catch.
 *
 * @returns {Map<string,object>}
 */
export function extract(html) {
  const rows = findPriceTable(html)
  const ids = findIdMap(html)
  const out = new Map()

  const unit = (r) => ({
    cacheHit: price(r[3]) ?? 0,
    cacheMiss: price(r[1]) ?? 0,
    output: price(r[2]) ?? 0
  })

  for (const r of rows.slice(1)) {
    if (r.length < 4) continue
    const rawName = r[0]

    // Shape 3: context-length tiers, e.g. "Grok 4.7 (≤ 200K tokens)".
    // The page uses the ≤ / > glyphs; accept ASCII <= and > too.
    const tier = /^(.*?)\s*\((\u2264|<=|<|>)\s*([0-9.]+)\s*([KM]?)\s*tokens?\)$/i.exec(rawName)
    if (tier) {
      const base = tier[1].trim()
      const over = tier[2] === '>'
      const limit = Number(tier[3]) * (tier[4].toUpperCase() === 'M' ? 1e6 : tier[4].toUpperCase() === 'K' ? 1e3 : 1)
      const id = ids[base] || slug(base)
      const entry = out.get(id) || {}
      entry.ctxLimit = limit
      if (over) entry.ctxOver = unit(r)
      else Object.assign(entry, unit(r))
      out.set(id, entry)
      continue
    }

    // Shape 2: peak/off-peak variants.
    const peakMatch = /^(.*?)\s*\((Off-)?Peak\)$/i.exec(rawName)
    if (peakMatch) {
      const base = peakMatch[1].trim()
      const isPeak = !peakMatch[2]
      const id = ids[base] || slug(base)
      const entry = out.get(id) || {}
      entry[isPeak ? 'peak' : 'offPeak'] = unit(r)
      out.set(id, entry)
      continue
    }

    // Shape 1: flat price. Free models render "-" everywhere; keep those as
    // explicit zeros so they price at 0 instead of being reported unpriced.
    const id = ids[rawName] || slug(rawName)
    out.set(id, { ...(out.get(id) || {}), ...unit(r) })
  }
  return out
}

/** "GLM-5.3-Flash" -> "glm-5.3-flash" fallback when the id table has no row. */
function slug(name) {
  return name.toLowerCase().replace(/\s+/g, '-')
}

// ── generation ──────────────────────────────────────────────────────────

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(n))

/** Render the GO_PRICING literal body, sorted by model id. */
export function renderFlat(map) {
  const lines = []
  for (const [id, u] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (u.peak || u.offPeak) continue // handled by GO_DEEPSEEK
    const tiers = u.ctxOver
      ? `, ctxLimit: ${u.ctxLimit}, ctxOver: { cacheHit: ${fmt(u.ctxOver.cacheHit)}, cacheMiss: ${fmt(u.ctxOver.cacheMiss)}, output: ${fmt(u.ctxOver.output)} }`
      : ''
    lines.push(
      `  ${(quote(id) + ':').padEnd(31)}{ cacheHit: ${fmt(u.cacheHit)}, cacheMiss: ${fmt(u.cacheMiss)}, output: ${fmt(u.output)}${tiers} },`
    )
  }
  return lines.join('\n')
}

/** Render the GO_DEEPSEEK literal body. */
export function renderDeepseek(map) {
  const lines = []
  for (const [id, u] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!u.peak && !u.offPeak) continue
    const off = u.offPeak || { cacheHit: 0, cacheMiss: 0, output: 0 }
    const pk = u.peak || off
    lines.push(
      `  ${quote(id)}: {\n` +
      `    offPeak: { cacheHit: ${fmt(off.cacheHit)}, cacheMiss: ${fmt(off.cacheMiss)}, output: ${fmt(off.output)} },\n` +
      `    peak:    { cacheHit: ${fmt(pk.cacheHit)}, cacheMiss: ${fmt(pk.cacheMiss)}, output: ${fmt(pk.output)} }\n` +
      `  }`
    )
  }
  return lines.join(',\n')
}

function quote(s) {
  return /^[a-z0-9.\-]+$/.test(s) ? `'${s}'` : `'${s.replace(/'/g, "\\'")}'`
}

// ── diffing ─────────────────────────────────────────────────────────────

function currentFrom(source) {
  const out = new Map()
  // Flat entries. The optional trailing group carries context-tier data and
  // the `manual` marker for hand-maintained stealth prices.
  const flat = /export const GO_PRICING = \{([\s\S]*?)\n\}/.exec(source)
  if (flat) {
    // Match each object literal up to its closing brace, then pull fields out
    // of the body. A single flat regex cannot handle the nested ctxOver object.
    const re = /'([^']+)':\s*\{([\s\S]*?)\},\n/g
    let m
    while ((m = re.exec(flat[1] + '\n'))) {
      const id = m[1]
      const body = m[2]
      const n = (k) => {
        const hit = new RegExp(k + ':\\s*([\\d.]+)').exec(body)
        return hit ? Number(hit[1]) : null
      }
      const ctx = /ctxOver:\s*\{([^}]*)\}/.exec(body)
      const entry = {
        cacheHit: n('cacheHit'),
        cacheMiss: n('cacheMiss'),
        output: n('output'),
        manual: /estimated:\s*true/.test(body)
      }
      if (ctx) {
        entry.ctxLimit = n('ctxLimit')
        entry.ctxOver = {
          cacheHit: Number(/cacheHit:\s*([\d.]+)/.exec(ctx[1])[1]),
          cacheMiss: Number(/cacheMiss:\s*([\d.]+)/.exec(ctx[1])[1]),
          output: Number(/output:\s*([\d.]+)/.exec(ctx[1])[1])
        }
      }
      out.set(id, entry)
    }
  }
  // Peak/off-peak entries.
  const ds = /export const GO_DEEPSEEK = \{([\s\S]*?)\n\}/.exec(source)
  if (ds) {
    const re = /'([^']+)':\s*\{\s*offPeak:\s*\{([^}]+)\},\s*peak:\s*\{([^}]+)\}/g
    let m
    while ((m = re.exec(ds[1]))) {
      const p = (chunk) => ({
        cacheHit: Number(/cacheHit:\s*([\d.]+)/.exec(chunk)[1]),
        cacheMiss: Number(/cacheMiss:\s*([\d.]+)/.exec(chunk)[1]),
        output: Number(/output:\s*([\d.]+)/.exec(chunk)[1])
      })
      out.set(m[1], { offPeak: p(m[2]), peak: p(m[3]) })
    }
  }
  // Models that are hand-maintained for reasons other than `estimated`
  // (e.g. union-alpha, which the docs page does not list at all).
  for (const id of MANUAL_ONLY) {
    if (out.has(id)) out.get(id).manual = true
  }
  return out
}

/**
 * Ids we curate by hand because the docs page cannot express them.
 * `union-alpha` has no public price; the page omits it entirely, so a
 * "gone from docs" report would be noise.
 */
const MANUAL_ONLY = new Set(['union-alpha'])

function sameUnit(a, b) {
  if (!a || !b) return false
  if (a.offPeak || b.offPeak) {
    const eq = (x, y) => x && y && x.cacheHit === y.cacheHit && x.cacheMiss === y.cacheMiss && x.output === y.output
    return eq(a.offPeak, b.offPeak) && eq(a.peak || a.offPeak, b.peak || b.offPeak)
  }
  const eq = (x, y) => x && y && x.cacheHit === y.cacheHit && x.cacheMiss === y.cacheMiss && x.output === y.output
  // Context tiers must match too, or a long-context price change goes unnoticed.
  if (!eq(a, b)) return false
  if (a.ctxOver || b.ctxOver) {
    return a.ctxLimit === b.ctxLimit && eq(a.ctxOver, b.ctxOver)
  }
  return true
}

function diff(current, remote) {
  const added = [], changed = [], removed = []
  for (const [id, u] of remote) {
    if (!current.has(id)) added.push([id, u])
    else if (!sameUnit(current.get(id), u)) changed.push([id, current.get(id), u])
  }
  for (const [id, u] of current) {
    if (u.manual) continue // never report hand-maintained entries as removed
    if (!remote.has(id)) removed.push([id, u])
  }
  return { added, changed, removed }
}

function showUnit(u) {
  if (u.offPeak || u.peak) {
    const o = u.offPeak || {}, p = u.peak || o
    return `off-peak hit/miss/out ${o.cacheHit}/${o.cacheMiss}/${o.output} · peak ${p.cacheHit}/${p.cacheMiss}/${p.output}`
  }
  let s = `hit/miss/out ${u.cacheHit}/${u.cacheMiss}/${u.output}`
  if (u.ctxOver) {
    s += ` · over ${u.ctxLimit} tokens: ${u.ctxOver.cacheHit}/${u.ctxOver.cacheMiss}/${u.ctxOver.output}`
  }
  return s
}

// ── main ────────────────────────────────────────────────────────────────

async function main() {
  const write = process.argv.includes('--write')
  const source = await readFile(PRICING_JS, 'utf8')
  const current = currentFrom(source)

  process.stdout.write(`Fetching ${SOURCE_URL} ...\n`)
  const html = await fetchPage(SOURCE_URL)
  const remote = extract(html)
  process.stdout.write(`Parsed ${remote.size} priced models from the docs page.\n\n`)

  const d = diff(current, remote)

  if (!d.added.length && !d.changed.length && !d.removed.length) {
    process.stdout.write('✅ Price table is already up to date.\n')
    return
  }

  if (d.added.length) {
    process.stdout.write(`NEW (${d.added.length}):\n`)
    for (const [id, u] of d.added) process.stdout.write(`  + ${id.padEnd(30)} ${showUnit(u)}\n`)
    process.stdout.write('\n')
  }
  if (d.changed.length) {
    process.stdout.write(`CHANGED (${d.changed.length}):\n`)
    for (const [id, was, now] of d.changed) {
      process.stdout.write(`  ~ ${id}\n      was: ${showUnit(was)}\n      now: ${showUnit(now)}\n`)
    }
    process.stdout.write('\n')
  }
  if (d.removed.length) {
    process.stdout.write(`GONE FROM DOCS (${d.removed.length}) — review before deleting:\n`)
    for (const [id] of d.removed) process.stdout.write(`  - ${id}\n`)
    process.stdout.write('\n')
  }

  if (!write) {
    process.stdout.write('Dry run. Re-run with --write to apply.\n')
    return
  }

  // Rebuild both literals. Hand-maintained entries always win over the page:
  // they exist precisely because the page has no price for them.
  const merged = new Map()
  for (const [id, u] of remote) merged.set(id, u)
  for (const [id, u] of current) if (u.manual) merged.set(id, u)

  const next = source
    .replace(
      /(export const GO_PRICING = \{)[\s\S]*?(\n\}\n)/,
      (_m, head, tail) => `${head}\n${renderFlat(withoutManual(merged))}\n\n${renderManual(current)}${tail}`
    )
    .replace(
      /(export const GO_DEEPSEEK = \{)[\s\S]*?(\n\}\n)/,
      (_m, head, tail) => `${head}\n${renderDeepseek(merged)}\n${tail}`
    )

  await writeFile(PRICING_JS, next)
  process.stdout.write(`Wrote ${PRICING_JS}\nRun the tests: npm test\n`)
}

/** Strip manual entries so renderFlat does not emit them twice. */
function withoutManual(map) {
  const out = new Map()
  for (const [id, u] of map) if (!u.manual) out.set(id, u)
  return out
}

/** Re-emit hand-maintained (stealth) entries with their original comments. */
function renderManual(current) {
  const rows = []
  for (const [id, u] of current) {
    if (!u.manual) continue
    rows.push(`  ${(quote(id) + ':').padEnd(31)}{ cacheHit: ${u.cacheHit}, cacheMiss: ${u.cacheMiss}, output: ${u.output}, estimated: true },`)
  }
  if (!rows.length) return ''
  return `  // (hand-maintained estimates — see the note above)\n${rows.join('\n')}\n`
}

// Only run when executed directly. Importing this module (e.g. from tests)
// must not hit the network.
const invokedDirectly = process.argv[1] &&
  fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`sync-pricing failed: ${err.message}\n`)
    process.exitCode = 1
  })
}
