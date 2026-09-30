# dsh-opencode-go-usage

**Token usage and cost tracking for OpenCode Zen Go models in DeepSeek Harness (DSH).**

A DSH Host + Client plugin that records every model call, prices it in **USD**
using the [OpenCode Zen Go](https://opencode.ai/docs/go/) rate card, and shows
the result in a usage panel plus a per-message token popup.

<sub>Built and maintained by [Scaefy](https://scaefy.com) — digital solutions agency. MIT licensed.</sub>

---

## Why this exists

The popular community plugin `dsh-usage-plugin` is built around the **official
DeepSeek tariff, denominated in CNY**. That is the right model if you call
`api.deepseek.com` directly — but if you route through a reseller or a
subscription plan, it cannot price your traffic at all.

Concretely, its `costFor()` ends with:

```js
if (provider !== 'deepseek-official' && provider !== 'deepseek') return 0
```

So every call through `opencode-go`, `opencode-go-extra` or
`opencode-optimisthub` is priced at **zero**, and the UI shows `¥0.0000` for a
session that actually cost real money. The model breakdown looks plausible,
which makes the zero especially easy to miss.

I hit this on a real workload: ~33,000 calls across 21 model/provider
combinations. The panel reported essentially nothing.

This plugin takes the opposite approach:

| | dsh-usage-plugin | dsh-opencode-go-usage |
|---|---|---|
| Provider in pricing | `deepseek-official` only | Zen Go providers first-class |
| Currency | CNY (¥) | **USD ($)**, no FX conversion |
| Unknown model | `0` | `null` — excluded and flagged |
| Stealth models | n/a | flagged `estimated`, not hidden |
| Peak window | shift bug (see below) | UTC, tested |

---

## Install

Requires DSH with a profile you control (the `desktop` profile is owned by the
Electron app; use `web` or a custom profile).

```bash
# from the profile directory, e.g. ~/.dsh/profiles/web
pnpm add /path/to/dsh-opencode-go-usage
```

Then register the bundle in that profile's `package.json`:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-opencode-go-usage"
      ]
    }
  }
}
```

and add the plugin row to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: opencode-go-usage
      name: 'dsh-opencode-go-usage'
      inject:
        - fs
        - webServer
        - sandboxPolicy
        - agents
```

Restart DSH. A **Usage** tab appears next to Conversation and Trace, and each
assistant message gets a **Token** button.

> The `inject` list matters: without it the plugin's `apply()` can run before
> the web server exists, the route never registers, and the panel just says it
> could not load data.

---

## What it shows

**Usage tab** — total cost (USD), call count, token totals, cache-hit rate, a
by-model table, and the most recent calls.

**Per-message popup** — the same numbers scoped to one session, broken down by
model, with input·miss / cache-hit / output split out.

Costs are computed with the official formula:

```
cost = (miss × cacheMiss + hit × cacheHit + output × output) / 1e6
```

Cache reads are billed at a small fraction of the miss rate, which is why a
session with 99% cache hits can move hundreds of millions of tokens for a few
cents.

---

## Pricing

### Zen Go list prices (USD / 1M tokens)

Verified against <https://opencode.ai/docs/go/> on **2026-09-30**. List prices
change — re-check that page before trusting these numbers, and open an issue if
something has drifted.

| Model | cache hit | cache miss | output |
|---|---:|---:|---:|
| `glm-5.3-flash` | 0.03 | 0.15 | 0.50 |
| `glm-5.3` / `glm-5.2` | 0.26 | 1.40 | 4.40 |
| `kimi-k3` | 0.30 | 3.00 | 15.00 |
| `kimi-k2.7-code` | 0.19 | 0.95 | 4.00 |
| `kimi-k2.6` | 0.16 | 0.95 | 4.00 |
| `longcat-2.0` | 0.006 | 0.30 | 1.20 |
| `mimo-v2.5` / `mimo-v2.6-flash` | 0.0028 | 0.14 | 0.28 |
| `mimo-v2.5-pro` / `mimo-v2.6-pro` | 0.003625 | 0.435 | 0.87 |
| `minimax-m3` / `minimax-m2.7` | 0.06 | 0.30 | 1.20 |
| `muse-spark-1.3-contributor` | 0.002 | 0.10 | 0.20 |
| `qwen3.8-max` | 0.25 | 2.00 | 6.00 |
| `qwen3.8-flash` | 0.016 | 0.15 | 0.47 |
| `qwen3.7-plus` | 0.04 | 0.40 | 1.60 |
| `grok-4.7` / `grok-4.6` | 0.50 | 2.00 | 6.00 |
| `gpt-6-luna` | 0.01 | 0.10 | 0.50 |
| `gpt-5.6-luna` | 0.02 | 0.20 | 1.20 |
| `hy4-preview` | 0.042 | 0.834 | 2.501 |
| `hy3` | 0.035 | 0.14 | 0.58 |
| `space-bunny-free`, `longcat-2.5-preview-free` | 0 | 0 | 0 |

### DeepSeek models on Zen Go (peak / off-peak)

| Model | | cache hit | cache miss | output |
|---|---|---:|---:|---:|
| `deepseek-v4.1-flash` | off-peak | 0.003 | 0.15 | 0.60 |
| | peak | 0.006 | 0.30 | 1.20 |
| `deepseek-v4-pro` | off-peak | 0.022 | 0.66 | 1.98 |
| | peak | 0.044 | 1.32 | 3.96 |

**Peak is weekdays 01:00–04:00 and 06:00–10:00 UTC.** Everything else,
including the whole weekend, is off-peak.

### ⚠️ Estimated prices

Two models in this table are **not** on any official price list:

- **`omen-alpha`** — a stealth model. OpenCode quotes roughly 11,600
  requests / 5 hours, which matches the `glm-5.3-flash` economics, so that tier
  is used as a stand-in. **This single assumption can swing your total by an
  order of magnitude** — on my own data it moved the bill between ~$2 and ~$74.
- **`union-alpha`** — free during its stealth window, then paid
  ($2.50 / $0.25 / $7.50) from 2026-09-17 23:24 UTC.

Estimates are marked `estimated: true` and the UI shows a warning rather than
folding them silently into the total. **Treat the total as an approximation
whenever a stealth model is in play, and reconcile against your real invoice.**

---

## Honest limitations

- **Attribution is per-call, not per-account.** If something else uses the same
  API key, its spend is invisible here.
- **Unpriced calls are excluded, not guessed.** A model missing from the table
  contributes `null` and the UI reports how many calls were skipped. The total
  is therefore a *lower bound* whenever that counter is non-zero.
- **Interrupted streams** are recorded as 0-token calls. The provider may still
  bill them; we cannot know the token count, so they are counted but not priced.
- **This is not an invoice.** It is a local estimate from stream usage data.

---

## How it works

```
lib/pricing.js   pure price table + cost formula (no I/O, unit-tested)
lib/index.js     host: listens on `llm/stream`, persists records, serves JSON
lib/client.js    client: Usage tab + per-message popup
```

Records are written atomically (temp file + rename) to:

```
~/dsh-kullanim-data/dsh-kullanim/kayitlar.json
```

Override with `DSH_KULLANIM_DIR`. A corrupt file is moved aside rather than
silently overwritten, so history is never destroyed by a bad read.

The HTTP route is `POST /kullanim/api` with actions `list`, `summary` and
`tokenForMessage`.

### Security note

`webServer.register` sits **outside** DSH's cookie-based auth gate, so a custom
route is reachable without a session. This plugin restricts its API to loopback
(`127.0.0.1` / `::1`) and returns 403 otherwise, because usage history is
personal. **If you fork this and expose it on a LAN or VPN address, add your own
access control.**

### Keeping prices current

List prices change, and a stale table quietly reports wrong money. The table is
**generated from the live docs page** rather than hand-copied:

```bash
npm run sync-pricing          # show what changed (dry run)
npm run sync-pricing:write    # rewrite lib/pricing.js
npm test                      # then verify
```

The script fetches <https://opencode.ai/docs/go/>, parses the price table plus
the display-name → model-id table, and diffs the result against what the plugin
ships. It reports three things:

- **NEW** — a model we do not price yet
- **CHANGED** — a price that moved
- **GONE FROM DOCS** — worth a look, but never deleted automatically

Hand-maintained entries (the stealth models) always win over the page, because
the page has no price for them by definition.

It caught a real bug on first run: `grok-4.7`, `grok-4.6`, `gpt-6-luna`,
`gpt-5.6-luna` and `qwen3.7-plus` are **priced by context length** — cheaper up
to a threshold, up to 2x above it. The original hand-written table had the cheap
tier only, so long-context calls were under-reported. Both tiers now ship, and
`costOf()` picks the tier from the record's prompt size.

> Prices are **not** fetched at runtime. The table stays baked into the source:
> a plugin doing network I/O on startup is slower, breaks offline, and would let
> a price change silently rewrite the cost of past calls. Run the sync script,
> review the diff, commit.

A good place to run this on a schedule is CI — a weekly job that opens a PR when
the diff is non-empty.

### Tests

```bash
npm test
```

25 tests, no network access, no dependencies:

- **`test/pricing.test.js`** — provider matching, the UTC peak window
  (weekends and exact boundaries), legacy model aliasing, the free/paid switch
  for `union-alpha`, context-length tiers and their exclusive boundary,
  `null` for unknown models, and the cost arithmetic.
- **`test/sync-pricing.test.js`** — the docs-page parser against a fixture
  covering flat rows, peak/off-peak pairs, context tiers, the `M` suffix and
  the free-model `-` case.

---

## Roadmap / contributions

- Backfill historical usage from DSH session files (`~/.dsh/sessions/**`)
- Per-day and per-session rollups with a date filter
- User-editable price table (currently source-edit)
- A scheduled CI job that opens a PR when `sync-pricing` finds a change
- Real prices for `omen-alpha` — **if you know them, please open an issue**

Issues and PRs welcome. If your provider uses different rates, the cleanest
change is a new entry in `GO_PRICING` plus a test.

---

## Built by Scaefy

This plugin was built and is maintained by **[Scaefy](https://scaefy.com)** — a
digital solutions agency doing WordPress, Laravel, e-commerce, SEO and
API / AI integrations.

It started as an internal tool. We run a lot of DSH traffic across Zen Go
models and needed to know what it actually costs, in USD, without hand-rolling a
spreadsheet every month. Once it worked, publishing it seemed more useful than
keeping it private — the pricing problems it solves are not specific to us.

If you need something like this for your own stack — API integrations, AI
tooling, or an internal panel that talks to your existing systems — that is the
kind of work we do:

- Website: <https://scaefy.com>
- Reviews: <https://clutch.co/profile/scaefy>

> The plugin is MIT-licensed and free to use, fork and ship. The agency
> mention is just credit for the work, not a licence condition.

---

## License

MIT
