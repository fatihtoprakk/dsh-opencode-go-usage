/**
 * dsh-opencode-go-usage — HOST half.
 *
 * Responsibilities:
 *   1. Listen on `llm/stream` and record token usage for every model call.
 *   2. Persist records atomically to a fixed directory (reloaded on restart).
 *   3. Serve JSON to the client half over `POST /usage/api`.
 *
 * Every identifier here is English, including the route and the data paths:
 * this is a public plugin, so nothing user-facing is named in another
 * language.
 */

import { randomUUID } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { paginate } from './ranges.js'
import {
  contextTokensOf,
  costOf,
  hasContextTier,
  isEstimated,
  isGoProvider,
  isOverContextTier,
  providerPricingSource,
  unitFor
} from './pricing.js'

const MAX_RECORDS = 100000
/** Default and maximum rows per page for the listing endpoint. */
const DEFAULT_PAGE = 50
const MAX_PAGE = 500
const API_PATH = '/usage/api'

/** Data root: DSH_USAGE_DIR env var, else ~/dsh-usage-data */
function dataRoot() {
  const env = String(process.env.DSH_USAGE_DIR || '').trim()
  if (env) return env
  return path.join(os.homedir(), 'dsh-usage-data')
}

export default {
  inject: ['fs', 'webServer', 'sandboxPolicy', 'agents'],
  apply(ctx) {
    const diag = { steps: [], error: null }
    const push = (s) => { try { diag.steps.push(String(s)) } catch (e) {} }

    let records = []
    let dataPath = ''
    let persistOk = false
    // Projected + sorted view for paged listing. Invalidated when a new record
    // arrives, so paging through a quiet period is cheap.
    let listCache = null

    // ── persistence ────────────────────────────────────────────────────────
    async function load() {
      try {
        const raw = await fsp.readFile(dataPath, 'utf8')
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) records = arr
        push('loaded=' + records.length)
      } catch (e) {
        if (e && e.code !== 'ENOENT') {
          // NEVER silently reset a corrupt file: move it aside and keep the data.
          const kept = dataPath + '.corrupt-' + Date.now() + '.json'
          try { await fsp.rename(dataPath, kept); push('corrupt-file-kept=' + kept) } catch (e2) {}
        }
        records = []
      }
    }

    // ── provider pricing overrides ─────────────────────────────────────────
    // { providerId: 'zen-go' | 'none' }. Set from the panel when a provider is
    // not recognised, so the user can price or exclude it without editing
    // source. Persisted next to the records.
    let overrides = {}
    let overridesPath = ''

    async function loadOverrides() {
      try {
        const arr = JSON.parse(await fsp.readFile(overridesPath, 'utf8'))
        if (arr && typeof arr === 'object' && !Array.isArray(arr)) {
          // Keep only the two known values, so a hand-edited file cannot
          // inject an arbitrary mode.
          for (const [k, v] of Object.entries(arr)) {
            if (v === 'zen-go' || v === 'none') overrides[String(k).toLowerCase()] = v
          }
        }
      } catch (e) {
        if (e && e.code !== 'ENOENT') {
          try { await fsp.rename(overridesPath, overridesPath + '.corrupt-' + Date.now()) } catch (e2) {}
        }
        overrides = {}
      }
    }

    let overrideChain = Promise.resolve()
    function persistOverrides() {
      overrideChain = overrideChain.then(async () => {
        if (!persistOk) return
        const tmp = overridesPath + '.tmp-' + process.pid
        try {
          await fsp.writeFile(tmp, JSON.stringify(overrides))
          await fsp.rename(tmp, overridesPath)
        } catch (e) {
          try { await fsp.unlink(tmp) } catch (e2) {}
        }
      }).catch(() => {})
      return overrideChain
    }

    let writeChain = Promise.resolve()
    function persist() {
      // Atomic write: write to a temp file, then rename. Concurrent calls are
      // chained so two writes can never clobber each other.
      writeChain = writeChain.then(async () => {
        if (!persistOk) return
        const tmp = dataPath + '.tmp-' + process.pid
        try {
          await fsp.writeFile(tmp, JSON.stringify(records))
          await fsp.rename(tmp, dataPath)
        } catch (e) {
          try { await fsp.unlink(tmp) } catch (e2) {}
        }
      }).catch(() => {})
      return writeChain
    }

    // ── bootstrap ─────────────────────────────────────────────────────────
    ;(async () => {
      try {
        const root = dataRoot()
        const dir = path.join(root, 'dsh-usage')
        await fsp.mkdir(dir, { recursive: true })
        dataPath = path.join(dir, 'records.json')
        overridesPath = path.join(dir, 'providers.json')
        await load()
        await loadOverrides()
        // writability probe
        await fsp.writeFile(dataPath + '.write-test', 'ok')
        await fsp.unlink(dataPath + '.write-test')
        persistOk = true
        push('persist-ok=' + dataPath)
      } catch (e) {
        persistOk = false
        push('persist-error=' + msg(e))
      }
      installListener()
      installRoutes()
      // Write the diagnostics file only now. Writing it inline in apply()
      // raced the async bootstrap above and reported persistOk=false /
      // dataPath="" on every healthy boot, which reads like data loss when
      // it is only a log-ordering artefact.
      writeBootLog()
    })()

    function msg(e) { return String((e && e.message) || e) }

    function currentSessionId() {
      try {
        const agents = ctx.get('agents')
        if (!agents) return ''
        const list = typeof agents.list === 'function' ? agents.list() : null
        if (Array.isArray(list) && list.length) {
          const a = list[list.length - 1]
          if (a && a.session && a.session.id) return String(a.session.id)
        }
      } catch (e) {}
      return ''
    }

    // ── llm/stream: capture every call ───────────────────────────────────
    function installListener() {
      try {
        ctx.on('llm/stream', function (options, next) {
          const source = next()
          const model = (options && options.model) || ''
          const provider = (options && options.provider) || ''
          const purpose = (options && options.purpose) ? String(options.purpose) : ''
          let sessionId = (options && options.sessionId) ? String(options.sessionId) : ''
          const startedAt = Date.now()
          let usage = null
          let finishReason = ''

          async function* observe() {
            try {
              for await (const chunk of source) {
                if (chunk && chunk.type === 'usage' && chunk.usage) usage = chunk.usage
                else if (chunk && chunk.type === 'finish') {
                  const r = chunk.reason
                  finishReason = r ? String(r.kind || '') : ''
                }
                yield chunk
              }
            } finally {
              try {
                if (!sessionId) sessionId = currentSessionId()
                if (usage) {
                  records.push({
                    recordId: randomUUID(),
                    time: startedAt,
                    model, provider, purpose, sessionId,
                    inputTokens: usage.inputTokens || 0,
                    outputTokens: usage.outputTokens || 0,
                    cacheReadTokens: usage.cacheReadTokens || 0,
                    cacheWriteTokens: usage.cacheWriteTokens || 0,
                    reasoningTokens: usage.reasoningTokens || 0,
                    finishReason
                  })
                } else if (isGoProvider(provider) && model) {
                  // Stream aborted: the harness emits no usage chunk, but the
                  // provider still bills the request. Record a 0-token
                  // "interrupted" call so the call count matches reality
                  // (zero cost, so it never inflates the total).
                  records.push({
                    recordId: randomUUID(),
                    time: startedAt,
                    model, provider, purpose, sessionId,
                    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
                    cacheWriteTokens: 0, reasoningTokens: 0,
                    finishReason: finishReason || 'aborted',
                    interrupted: true
                  })
                }
                if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
                listCache = null
                persist()
              } catch (e) { push('observe-error=' + msg(e)) }
            }
          }
          return observe()
        })
        push('llm-stream-listener-ok')
      } catch (e) {
        push('llm-stream-listener-error=' + msg(e))
      }
    }

    // ── record -> API shape ──────────────────────────────────────────────
    function project(rec) {
      const ts = rec.time
      const ctx = contextTokensOf(rec)
      const cost = costOf(rec, ts, overrides)
      // Pass the prompt size so tiered models report the tier they were billed at.
      const u = unitFor(rec.provider, rec.model, ts, ctx, overrides)
      const tiered = hasContextTier(rec.model)
      return {
        time: rec.time,
        model: rec.model,
        provider: rec.provider,
        purpose: rec.purpose || '',
        sessionId: rec.sessionId || '',
        finishReason: rec.finishReason || '',
        interrupted: !!rec.interrupted,
        inputTokens: rec.inputTokens || 0,
        outputTokens: rec.outputTokens || 0,
        cacheReadTokens: rec.cacheReadTokens || 0,
        cacheWriteTokens: rec.cacheWriteTokens || 0,
        reasoningTokens: rec.reasoningTokens || 0,
        // Cost is USD. null = we have no price for this model.
        costUsd: cost,
        priced: cost !== null,
        pricingSource: providerPricingSource(rec.provider, overrides),
        estimated: isEstimated(rec.provider, rec.model),
        peak: !!(u && u !== null && isPeakSafe(ts)),
        // Context-length tier reporting, so the UI can explain a 2x rate.
        contextTokens: ctx,
        tiered,
        overContextTier: isOverContextTier(rec.model, ctx),
        currency: 'USD'
      }
    }

    function isPeakSafe(ts) {
      try {
        const d = new Date(ts)
        const day = d.getUTCDay()
        if (day === 0 || day === 6) return false
        const h = d.getUTCHours()
        return (h >= 1 && h < 4) || (h >= 6 && h < 10)
      } catch (e) { return false }
    }

    function aggregate(list) {
      let calls = 0, input = 0, output = 0, cacheRead = 0, cacheWrite = 0
      let reasoning = 0, cost = 0, pricedCalls = 0, unpricedCalls = 0
      let estimatedCalls = 0, interrupted = 0, overTierCalls = 0
      const byModel = {}
      for (const r of list) {
        calls++
        input += r.inputTokens; output += r.outputTokens
        cacheRead += r.cacheReadTokens; cacheWrite += r.cacheWriteTokens
        reasoning += r.reasoningTokens
        if (r.interrupted) interrupted++
        const key = r.provider + '/' + r.model
        const m = byModel[key] || (byModel[key] = {
          model: r.model, provider: r.provider, calls: 0,
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
          costUsd: 0, priced: r.priced, estimated: r.estimated, unpriced: 0,
          tiered: r.tiered, overTierCalls: 0
        })
        m.calls++
        m.input += r.inputTokens; m.output += r.outputTokens
        m.cacheRead += r.cacheReadTokens; m.cacheWrite += r.cacheWriteTokens
        m.reasoning += r.reasoningTokens
        if (r.priced) { m.costUsd += r.costUsd; cost += r.costUsd; pricedCalls++ }
        else { m.unpriced++; unpricedCalls++ }
        if (r.estimated) estimatedCalls++
        if (r.overContextTier) { overTierCalls++; m.overTierCalls = (m.overTierCalls || 0) + 1 }
      }
      const tokens = input + output + cacheRead + cacheWrite
      const hitRate = (cacheRead + input) > 0 ? (cacheRead / (cacheRead + input)) * 100 : 0

      // Which providers could not be priced, and how many calls each cost.
      // Reported by name so the user can price or exclude them in one click
      // instead of hunting through the source for a provider list.
      const unpricedProviders = {}
      const patternProviders = {}
      for (const r of list) {
        const p = String(r.provider || '').trim().toLowerCase()
        if (!p) continue
        if (r.pricingSource === 'pattern') patternProviders[p] = (patternProviders[p] || 0) + 1
        if (!r.priced) unpricedProviders[p] = (unpricedProviders[p] || 0) + 1
      }
      return {
        calls, input, output, cacheRead, cacheWrite, reasoning, tokens,
        costUsd: cost, pricedCalls, unpricedCalls, estimatedCalls, interrupted, overTierCalls,
        hitRate,
        unpricedProviders: Object.entries(unpricedProviders)
          .map(([provider, calls]) => ({ provider, calls }))
          .sort((a, b) => b.calls - a.calls),
        patternProviders: Object.entries(patternProviders)
          .map(([provider, calls]) => ({ provider, calls }))
          .sort((a, b) => b.calls - a.calls),
        overrides: { ...overrides },
        byModel: Object.values(byModel).sort((a, b) => b.costUsd - a.costUsd)
      }
    }

    // ── HTTP ─────────────────────────────────────────────────────────────
    async function readBody(req) {
      const chunks = []
      for await (const c of req) chunks.push(c)
      if (!chunks.length) return {}
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (e) { return {} }
    }
    function sendJson(res, obj, code) {
      const body = JSON.stringify(obj)
      res.writeHead(code || 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      })
      res.end(body)
    }

    function inRange(list, from, to) {
      return list.filter((r) => (!from || r.time >= from) && (!to || r.time <= to))
    }

    async function routeApi(body) {
      const action = body && body.action

      if (action === 'tokenForMessage') {
        const sid = String(body.sessionId || '')
        const inSession = records.filter((r) => r.sessionId === sid).map(project)
        const turn = inRange(inSession, body.from, body.to)
        const convo = aggregate(inSession)
        const agg = aggregate(turn)
        return { ok: true, conversation: convo, aggregate: agg, records: turn }
      }

      // Paged listing. The response never carries more than `limit` rows, and
      // `aggregate` is computed over every record regardless of the page, so
      // the totals stay stable while the user walks through pages.
      if (action === 'list') {
        const requestId = body.requestId
        // Cache the projected + sorted view: a new record invalidates it, so
        // paging through a quiet period does not re-project the whole history
        // on every click.
        if (!listCache || listCache.count !== records.length || listCache.requestId !== requestId) {
          const rows = records.map(project).sort((a, b) => b.time - a.time)
          listCache = { count: records.length, requestId, rows, aggregate: aggregate(rows) }
        }
        const { rows, aggregate: agg } = listCache

        const page = paginate(rows, body.offset, body.limit, DEFAULT_PAGE, MAX_PAGE)
        return {
          ok: true,
          records: page.records,
          total: rows.length,
          offset: page.offset,
          limit: page.limit,
          hasMore: page.hasMore,
          aggregate: agg
        }
      }

      // Price or exclude a provider the plugin could not recognise. Called
      // from the warning row in the panel, so the user never edits source.
      if (action === 'setProviderPricing') {
        const id = String(body.provider || '').trim().toLowerCase()
        const mode = body.mode
        if (!id) return { ok: false, error: 'provider is required' }
        if (mode !== 'zen-go' && mode !== 'none' && mode !== null) {
          return { ok: false, error: 'mode must be "zen-go", "none" or null' }
        }
        // Guard against a provider id smuggling in path separators or being
        // used as a prototype key.
        if (!/^[a-z0-9][a-z0-9._-]{0,80}$/.test(id) || id === '__proto__') {
          return { ok: false, error: 'invalid provider id' }
        }
        if (mode === null) delete overrides[id]
        else overrides[id] = mode
        await persistOverrides()
        listCache = null
        return { ok: true, overrides: { ...overrides } }
      }

      if (action === 'summary') {
        const rows = inRange(records.map(project), body.from, body.to)
        return { ok: true, aggregate: aggregate(rows) }
      }

      return { ok: false, error: 'unknown action: ' + String(action), actions: ['list', 'summary', 'tokenForMessage', 'setProviderPricing'] }
    }

    function installRoutes() {
      const webServer = ctx.get('webServer')
      push('webServer=' + (webServer ? 'present' : 'undefined'))
      if (!webServer || typeof webServer.register !== 'function') return
      try {
        webServer.register({
          kind: 'exact',
          path: API_PATH,
          handler: async (req, res) => {
            try {
              // Security: webServer.register sits OUTSIDE the host's
              // cookie-based auth gate, so this route is reachable without a
              // session. Restrict it to loopback: requests arriving over
              // Tailscale/LAN are rejected.
              // (Usage data is personal — it exposes your token and cost
              // history to anyone who can reach the port.)
              if (!isLoopback(req)) {
                sendJson(res, { ok: false, error: 'local access only' }, 403)
                return
              }
              const body = req.method === 'POST' ? await readBody(req) : {}
              sendJson(res, await routeApi(body))
            } catch (e) {
              sendJson(res, { ok: false, error: msg(e) }, 500)
            }
          }
        })
        push('route-ok=' + API_PATH)
      } catch (e) {
        push('route-error=' + msg(e))
      }
    }

    /** Did this request arrive over loopback? (127.0.0.1 / ::1 / ::ffff:127.0.0.1) */
    function isLoopback(req) {
      try {
        const a = String((req.socket && req.socket.remoteAddress) || '')
        return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a.endsWith('127.0.0.1')
      } catch (e) {
        return false
      }
    }

    // Diagnostics file: read this if the plugin fails to load. Called at the
    // end of the bootstrap, never inline in apply(), so the values it reports
    // are the settled ones.
    function writeBootLog() {
      try {
        const fs = ctx.get('fs')
        if (fs && typeof fs.resolve === 'function' && typeof fs.writeText === 'function') {
          fs.resolve('dsh-usage-boot.log')
            .then((t) => fs.writeText(t, JSON.stringify({ time: Date.now(), persistOk, dataPath, ...diag }, null, 2)))
            .catch(() => {})
        }
      } catch (e) {}
    }
  }
}
