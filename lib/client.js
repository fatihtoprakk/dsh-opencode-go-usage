window.__ModuleLoader__.load({
  id: "dsh-opencode-go-usage",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var el = React.createElement;
    var ReactDOM = null;
    try { ReactDOM = require("react-dom"); } catch (e) {}

    var API = "/kullanim/api";

    // ── formatting ──────────────────────────────────────────────────────
    // Amounts are USD. There is no ¥ in this plugin; the symbol is always $.
    var fmtInt = function (n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); };
    var fmtUsd = function (n) {
      if (n == null) return "—";
      if (!n) return "$0.0000";
      if (n < 0.0001) return "$" + n.toExponential(2);
      if (n < 1) return "$" + n.toFixed(4);
      return "$" + n.toFixed(2);
    };
    var fmtDur = function (ms) {
      if (!ms || ms <= 0) return "0s";
      var s = Math.round(ms / 1000), m = Math.floor(s / 60), r = s % 60;
      return m > 0 ? (m + "m" + r + "s") : (r + "s");
    };

    function api(body) {
      return fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      }).then(function (r) { return r.json(); });
    }

    var S = {
      overlay: { position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
      card: { background: "#fff", color: "#1c2733", borderRadius: 12, maxWidth: "min(680px,94vw)", width: "100%", maxHeight: "calc(100vh - 40px)", overflowY: "auto", boxShadow: "0 14px 44px rgba(0,0,0,.4)", padding: "14px 16px", fontSize: 12.5 },
      title: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, fontWeight: 600, marginBottom: 10 },
      title2: { fontSize: 13, fontWeight: 600, margin: "12px 0 6px" },
      hint: { fontSize: 11.5, opacity: 0.6, marginBottom: 10 },
      close: { border: "1px solid #d5dbe3", background: "#f7f8fa", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12 },
      statRow: { display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 },
      stat: { flex: "1 1 0", minWidth: 96, background: "#f5f7fa", borderRadius: 8, padding: "8px 10px" },
      statLabel: { fontSize: 11, opacity: 0.6, marginBottom: 2 },
      statValue: { fontSize: 15, fontWeight: 700 },
      barWrap: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 },
      barTrack: { flex: 1, height: 12, borderRadius: 999, background: "#eef1f5", overflow: "hidden" },
      barFill: { height: "100%", borderRadius: 999, background: "#22a45d" },
      barLabel: { fontSize: 11.5, whiteSpace: "nowrap", opacity: 0.85 },
      mCard: { background: "#f7f8fa", borderRadius: 8, padding: "8px 10px", marginBottom: 8 },
      mHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 },
      mName: { fontWeight: 600, fontSize: 12, flex: "1 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      mCost: { fontWeight: 700, whiteSpace: "nowrap" },
      mLine: { fontSize: 11.5, opacity: 0.85, overflowWrap: "anywhere" },
      row: { display: "flex", gap: 8, padding: "5px 0", borderBottom: "1px solid #eef1f5", fontSize: 12, alignItems: "center" },
      tab: { padding: 16, fontSize: 13, color: "#1c2733" },
      table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
      th: { textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #e3e8ee", fontSize: 11, opacity: 0.7, whiteSpace: "nowrap" },
      td: { padding: "6px 8px", borderBottom: "1px solid #eef1f5", whiteSpace: "nowrap" },
      tdr: { padding: "6px 8px", borderBottom: "1px solid #eef1f5", whiteSpace: "nowrap", textAlign: "right" },
      warn: { background: "#fff8e6", border: "1px solid #f0d9a0", borderRadius: 8, padding: "8px 10px", fontSize: 11.5, marginBottom: 12, lineHeight: 1.5 },
      pager: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", margin: "10px 0 6px" },
      pagerInfo: { fontSize: 11.5, opacity: 0.75, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
      pagerLabel: { fontSize: 11.5, opacity: 0.6 },
      select: { fontSize: 11.5, padding: "3px 6px", borderRadius: 7, border: "1px solid #d5dbe3", background: "#fff", color: "#1c2733", cursor: "pointer" },
      btnGroup: { display: "inline-flex", alignItems: "center", gap: 6 },
      pageBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid #d5dbe3", background: "#fff", borderRadius: 7, padding: "4px 7px", cursor: "pointer", color: "#33414f", lineHeight: 1 },
      pageBtnOff: { display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid #e6eaf0", background: "#fafbfc", borderRadius: 7, padding: "4px 7px", color: "#b6bfc9", lineHeight: 1, cursor: "default" },
      iconBtn: { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #d5dbe3", background: "#fff", borderRadius: 8, padding: "5px 11px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#33414f", lineHeight: 1 },
      iconBtnBusy: { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #d5dbe3", background: "#f5f7fa", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 600, color: "#8a949e", lineHeight: 1, cursor: "default" },
      quotaWrap: { display: "inline-flex", alignItems: "center", gap: 7, justifyContent: "flex-end" },
      quotaBar: { position: "relative", width: 60, height: 6, borderRadius: 4, background: "#eaeef3", overflow: "hidden", flex: "0 0 auto" },
      quotaFill: { height: "100%", borderRadius: 4 },
      quotaPct: { fontSize: 11, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", minWidth: 40, textAlign: "right" },
      quotaNote: { fontSize: 10.5, opacity: 0.45 },
      planCard: { flex: "1 1 240px", minWidth: 220, border: "1px solid #e3e8ee", borderRadius: 10, padding: "10px 12px", background: "#fff" },
      planHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
      planName: { fontSize: 12.5, fontWeight: 700 },
      planPrice: { fontSize: 11, opacity: 0.6 },
      winRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 5 },
      winLabel: { fontSize: 10.5, opacity: 0.65, width: 52, flex: "0 0 auto" },
      winTrack: { flex: "1 1 auto", height: 7, borderRadius: 4, background: "#eef1f5", overflow: "hidden" },
      winFill: { height: "100%", borderRadius: 4 },
      winPct: { fontSize: 10.5, fontVariantNumeric: "tabular-nums", minWidth: 46, textAlign: "right", flex: "0 0 auto" }
    };

    /**
     * Inline SVG icon, built from path data rather than a text glyph so the
     * buttons do not depend on a font carrying the arrow/refresh codepoints.
     */
    var ICONS = {
      first: "M11 4 5 10l6 6",
      prev: "M12 4 6 10l6 6",
      next: "M8 4l6 6-6 6",
      last: "M9 4l6 6-6 6",
      refresh: "M13.6 5.2A6 6 0 1 0 16 10M16 10V5.5M16 10h-4.5"
    };

    function icon(name, size) {
      var d = ICONS[name];
      if (!d) return null;
      var kids = [el("path", {
        key: "p", d: d, fill: "none", stroke: "currentColor",
        strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round"
      })];
      // The skip-to-end buttons get a vertical bar after the chevron.
      if (name === "first" || name === "last") {
        kids.push(el("path", {
          key: "b", d: name === "first" ? "M4 4v12" : "M16 4v12",
          fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round"
        }));
      }
      return el("svg", {
        width: size || 12, height: size || 12, viewBox: "0 0 20 20",
        style: { display: "block", flex: "0 0 auto" }, "aria-hidden": "true"
      }, kids);
    }

    /** Quota bar colour: calm below 60%, amber to 85%, red past it. */
    function quotaColor(pct) {
      if (pct >= 85) return "#d64545";
      if (pct >= 60) return "#d99413";
      return "#3f9142";
    }

    /** One quota cell: plan tag, bar, percentage. */
    /** One window row: label, bar, percentage. */
    function winRow(label, win) {
      var pct = Math.max(0, win.percent);
      var c = quotaColor(pct);
      return el("div", { style: S.winRow, title: "Limit $" + win.limit.toFixed(2) },
        el("span", { style: S.winLabel }, label),
        el("span", { style: S.winTrack },
          el("span", { style: {
            display: "block", height: "100%", borderRadius: 4,
            width: Math.min(100, pct) + "%", background: c
          } })
        ),
        el("span", { style: Object.assign({}, S.winPct, { color: c }) },
          pct < 10 ? pct.toFixed(2) + "%" : pct.toFixed(1) + "%")
      );
    }

    /**
     * Plan allowance summary: one card per plan, each with the 5-hour, weekly
     * and monthly windows.
     *
     * Per-model allowances cannot be summed into one honest figure (every model
     * has its own budget), so each card reports the model closest to its limit
     * and names it. That is the number that would actually stop you.
     */
    function planSummary(byModel) {
      var rows = (byModel || []).filter(function (m) { return m.quota && m.quota.go; });
      if (!rows.length) {
        return el("div", { style: S.hint },
          "No plan allowance to show yet — no priced Zen Go calls recorded.");
      }
      return el("div", { style: { display: "flex", flexWrap: "wrap", gap: 10 } },
        ["go", "plus"].map(function (plan) {
          var ranked = rows
            .map(function (m) { return { model: m.model, q: m.quota[plan] }; })
            .filter(function (x) { return !!x.q; })
            .sort(function (a, b) { return b.q.percent - a.q.percent; });
          if (!ranked.length) return null;
          var top = ranked[0];
          return el("div", { key: plan, style: S.planCard },
            el("div", { style: S.planHead },
              el("span", { style: S.planName }, plan === "plus" ? "Go Plus" : "Go"),
              el("span", { style: S.planPrice }, plan === "plus" ? "$40/month" : "$10/month")
            ),
            winRow("5 hours", top.q.windows.fiveHour),
            winRow("Week", top.q.windows.weekly),
            winRow("Month", top.q.windows.monthly),
            el("div", { style: { fontSize: 10.5, opacity: 0.6, marginTop: 6 } },
              "Highest: " + top.model + " · $" + top.q.monthly + " budget" +
              (ranked.length > 1 ? " · " + ranked.length + " models" : ""))
          );
        })
      );
    }

    function stat(label, value) {
      return el("div", { style: S.stat },
        el("div", { style: S.statLabel }, label),
        el("div", { style: S.statValue }, value)
      );
    }

    // ── per-message token button + popup ────────────────────────────────
    function TokenAction(props) {
      var st = React.useState(false);
      var open = st[0], setOpen = st[1];
      var ds = React.useState({ status: "idle", data: null });
      var s1 = ds[0], setData = ds[1];

      React.useEffect(function () {
        if (!open || !props.sessionId) return;
        setData({ status: "loading", data: null });
        api({ action: "tokenForMessage", sessionId: props.sessionId })
          .then(function (r) { setData({ status: r && r.ok ? "done" : "error", data: r }) })
          .catch(function () { setData({ status: "error", data: null }); });
      }, [open, props.sessionId]);

      var d = s1.status === "done" ? s1.data : null;
      var agg = d && d.aggregate ? d.aggregate : null;
      var convo = d && d.conversation ? d.conversation : null;
      var label = "Token";
      if (s1.status === "done" && agg) label = "Token " + fmtInt(agg.tokens);
      if (s1.status === "error") label = "Token —";

      function body() {
        if (s1.status === "loading") return el("div", { style: S.hint }, "Loading…");
        if (s1.status === "error") return el("div", { style: S.hint }, "Query failed");
        if (!agg || agg.calls === 0) return el("div", { style: S.hint }, "No records for this session yet.");
        return el("div", null,
          convo ? el("div", null,
            el("div", { style: S.title2 }, "Session total"),
            el("div", { style: S.statRow },
              stat("Total tokens", fmtInt(convo.tokens)),
              stat("Total cost (USD)", fmtUsd(convo.costUsd)),
              stat("Calls", fmtInt(convo.calls)),
              stat("Cache hit", (convo.hitRate ? convo.hitRate.toFixed(1) : "0") + "%")
            )
          ) : null,
          el("div", { style: S.title2 }, "Models in this session"),
          el("div", { style: S.statRow },
            stat("Token", fmtInt(agg.tokens)),
            stat("Cost (USD)", fmtUsd(agg.costUsd)),
            stat("Calls", fmtInt(agg.calls)),
            stat("Cache hit", (agg.hitRate ? agg.hitRate.toFixed(1) : "0") + "%")
          ),
          el("div", { style: S.barWrap },
            el("div", { style: S.barTrack },
              el("div", { style: Object.assign({}, S.barFill, { width: Math.min(100, agg.hitRate || 0) + "%" }) })
            ),
            el("span", { style: S.barLabel }, "Cache hit " + (agg.hitRate ? agg.hitRate.toFixed(1) : "0") + "%")
          ),
        agg.estimatedCalls > 0 ? el("div", { style: S.warn },
            "⚠ " + fmtInt(agg.estimatedCalls) + " call(s) used an ESTIMATED price (stealth model with no published rate). The real total may differ."
          ) : null,
          agg.unpricedCalls > 0 ? el("div", { style: S.warn },
            "⚠ " + fmtInt(agg.unpricedCalls) + " call(s) could not be priced (model/provider missing from the price list) and are excluded from the total."
          ) : null,
          agg.overTierCalls > 0 ? el("div", { style: S.warn },
            fmtInt(agg.overTierCalls) + " call(s) exceeded the model's context threshold and were billed at the higher tier (up to 2x)."
          ) : null,
          el("div", { style: S.title2 }, "By model"),
          agg.byModel.map(function (m, i) {
            return el("div", { key: String(i), style: S.mCard },
              el("div", { style: S.mHead },
                el("span", { style: S.mName, title: m.model }, m.model),
                el("span", { style: S.mCost }, fmtUsd(m.costUsd))
              ),
              el("div", { style: S.mLine },
                "input·miss " + fmtInt(m.input) + " · cache hit " + fmtInt(m.cacheRead) +
                " · output " + fmtInt(m.output) + (m.reasoning ? " · reasoning " + fmtInt(m.reasoning) : "")
              ),
              el("div", { style: S.mLine },
                el("span", { style: { color: "#8a94a6" } },
                  m.provider + " · " + fmtInt(m.calls) + " calls" + (m.unpriced ? " · " + fmtInt(m.unpriced) + " unpriced" : "")
                )
              )
            );
          })
        );
      }

      var overlay = open ? el("div", { style: S.overlay, onClick: function () { setOpen(false); } },
        el("div", { style: S.card, onClick: function (e) { e.stopPropagation(); } },
          el("div", { style: S.title },
            el("span", null, "Token details"),
            el("button", { style: S.close, onClick: function () { setOpen(false); } }, "Close")
          ),
          body()
        )
      ) : null;
      if (overlay && ReactDOM && ReactDOM.createPortal && typeof document !== "undefined" && document.body) {
        overlay = ReactDOM.createPortal(overlay, document.body);
      }

      return el("div", { style: { display: "inline-flex", alignItems: "center", gap: 4 } },
        el("button", {
          type: "button",
          style: Object.assign({}, S.close, { fontSize: 11, padding: "0 6px" }),
          title: "Token details",
          onClick: function () { setOpen(true); }
        }, label),
        overlay
      );
    }

    // ── "Usage" tab ─────────────────────────────────────────────────────
    var PAGE_SIZES = [25, 50, 100, 250];

    function UsagePanel() {
      var ds = React.useState({ status: "idle", data: null });
      var s1 = ds[0], setData = ds[1];
      var ps = React.useState(50);
      var pageSize = ps[0], setPageSize = ps[1];
      var os = React.useState(0);
      var offset = os[0], setOffset = os[1];

      // Only the current page is fetched; totals come back with every page so
      // the summary stays stable while paging.
      function load(nextOffset, nextSize) {
        setData({ status: "loading", data: null });
        api({ action: "list", offset: nextOffset, limit: nextSize })
          .then(function (r) { setData({ status: r && r.ok ? "done" : "error", data: r }); })
          .catch(function () { setData({ status: "error", data: null }); });
      }
      React.useEffect(function () { load(offset, pageSize); }, [offset, pageSize]);

      if (s1.status === "loading") return el("div", { style: S.tab }, "Loading…");
      if (s1.status === "error") return el("div", { style: S.tab }, "Could not load data. Is the plugin installed?");

      var d = s1.data || {};
      var agg = d.aggregate || { calls: 0, byModel: [], tokens: 0, costUsd: 0, hitRate: 0 };
      var recs = d.records || [];
      var total = d.total || 0;
      var shown = d.offset || 0;

      function go(next) {
        var clamped = Math.max(0, Math.min(next, Math.max(0, total - 1)));
        if (clamped !== offset) setOffset(clamped);
      }
      function changeSize(n) {
        // Keep the first visible row roughly in view when the page size changes.
        setOffset(Math.floor(offset / n) * n);
        setPageSize(n);
      }

      var pageInfo = total === 0 ? "No calls recorded yet"
        : (shown + 1) + "–" + (shown + recs.length) + " of " + fmtInt(total);

      var loading = s1.status === "loading";

      // Icon-only pager buttons, with a tooltip and a disabled look that does
      // not rely on the browser's default disabled rendering.
      function pageBtn(key, iconName, title, target, enabled) {
        return el("button", {
          key: key, type: "button", title: title, "aria-label": title,
          style: enabled ? S.pageBtn : S.pageBtnOff,
          disabled: !enabled,
          onClick: enabled ? function () { go(target); } : null
        }, icon(iconName));
      }

      var lastOffset = Math.floor(Math.max(0, total - 1) / pageSize) * pageSize;
      var pager = el("div", { style: S.pager },
        el("span", { style: S.pagerInfo }, pageInfo),
        el("span", { style: S.btnGroup },
          el("label", { style: S.pagerLabel }, "per page"),
          el("select", {
            style: S.select,
            value: String(pageSize),
            onChange: function (e) { changeSize(Number(e.target.value)); }
          }, PAGE_SIZES.map(function (n) { return el("option", { key: n, value: String(n) }, String(n)); })),
          pageBtn("first", "first", "First page", 0, offset > 0),
          pageBtn("prev", "prev", "Previous page", offset - pageSize, offset > 0),
          pageBtn("next", "next", "Next page", offset + pageSize, !!d.hasMore),
          pageBtn("last", "last", "Last page", lastOffset, !!d.hasMore)
        )
      );

      return el("div", { style: S.tab },
        el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } },
          el("div", { style: { fontSize: 15, fontWeight: 700 } }, "Usage & cost"),
          el("button", {
            type: "button", title: "Reload usage data",
            style: loading ? S.iconBtnBusy : S.iconBtn,
            disabled: loading,
            onClick: function () { load(offset, pageSize); }
          }, icon("refresh", 13), el("span", null, loading ? "Loading…" : "Refresh"))
        ),
        el("div", { style: S.hint },
          "Prices come from the official OpenCode Zen Go list (USD). Only opencode-go / -extra / optimisthub are priced."
        ),
        el("div", { style: S.statRow },
          stat("Total cost", fmtUsd(agg.costUsd)),
          stat("Calls", fmtInt(agg.calls)),
          stat("Token", fmtInt(agg.tokens)),
          stat("Cache hit", (agg.hitRate ? agg.hitRate.toFixed(1) : "0") + "%")
        ),
        el("div", { style: S.title2 }, "Plan allowance"),
        el("div", { style: S.hint },
          "Each model has its own monthly budget; the bars show the model closest to its limit. Windows are 20% / 50% / 100% of that budget."
        ),
        planSummary(agg.byModel),

        agg.estimatedCalls > 0 ? el("div", { style: S.warn },
          "⚠ " + fmtInt(agg.estimatedCalls) + " call(s) used an estimated price (no published rate for that model). These add real uncertainty to the total."
        ) : null,
        agg.unpricedCalls > 0 ? el("div", { style: S.warn },
          "⚠ " + fmtInt(agg.unpricedCalls) + " call(s) could not be priced (model/provider not in the price list) — excluded from the total."
        ) : null,
        agg.overTierCalls > 0 ? el("div", { style: S.warn },
          fmtInt(agg.overTierCalls) + " call(s) exceeded the model's context-length threshold and were billed at the higher tier (up to 2x)."
        ) : null,
        agg.interrupted > 0 ? el("div", { style: S.warn },
          fmtInt(agg.interrupted) + " interrupted/failed call(s) recorded (0 tokens, assumed unbilled)."
        ) : null,

        el("div", { style: S.title2 }, "By model"),
        el("table", { style: S.table },
          el("thead", null, el("tr", null,
            el("th", { style: S.th }, "Model"),
            el("th", { style: S.th }, "Provider"),
            el("th", { style: S.th }, "Calls"),
            el("th", { style: S.th }, "Input·miss"),
            el("th", { style: S.th }, "Cache hit"),
            el("th", { style: S.th }, "Output"),
            el("th", { style: S.th }, "Cost (USD)")
          )),
          el("tbody", null, agg.byModel.map(function (m, i) {
            return el("tr", { key: String(i) },
              el("td", { style: S.td }, m.model + (m.estimated ? " ⚠" : "") + (m.overTierCalls ? " ·over-tier" : "")),
              el("td", { style: S.td }, m.provider),
              el("td", { style: S.tdr }, fmtInt(m.calls)),
              el("td", { style: S.tdr }, fmtInt(m.input)),
              el("td", { style: S.tdr }, fmtInt(m.cacheRead)),
              el("td", { style: S.tdr }, fmtInt(m.output)),
              el("td", { style: S.tdr }, m.unpriced && !m.costUsd ? "unpriced" : fmtUsd(m.costUsd))
            );
          }))
        ),

        el("div", { style: S.title2 }, "Recent calls"),
        pager,
        el("table", { style: S.table },
          el("thead", null, el("tr", null,
            el("th", { style: S.th }, "Time"),
            el("th", { style: S.th }, "Model"),
            el("th", { style: S.th }, "miss"),
            el("th", { style: S.th }, "hit"),
            el("th", { style: S.th }, "output"),
            el("th", { style: S.th }, "USD")
          )),
          el("tbody", null, recs.map(function (r, i) {
            var dt = new Date(r.time);
            var hh = String(dt.getHours()).padStart(2, "0") + ":" + String(dt.getMinutes()).padStart(2, "0") + ":" + String(dt.getSeconds()).padStart(2, "0");
            return el("tr", { key: String(i), style: r.interrupted ? { opacity: 0.55 } : null },
              el("td", { style: S.td }, hh),
              el("td", { style: S.td }, r.model + (r.interrupted ? " (interrupted)" : "")),
              el("td", { style: S.tdr }, fmtInt(r.inputTokens)),
              el("td", { style: S.tdr }, fmtInt(r.cacheReadTokens)),
              el("td", { style: S.tdr }, fmtInt(r.outputTokens)),
              el("td", { style: S.tdr }, r.priced ? fmtUsd(r.costUsd) : "—")
            );
          }))
        ),
        recs.length ? pager : null
      );
    }

    var inject = ["slots"];
    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) return;

      slots.inject("conversation.view", function () {
        return slots.register(
          { name: "conversation.view", id: "kullanim-view", order: 25, label: function () { return "Usage"; } },
          function () { return el("div", { style: S.tab }, el(UsagePanel, null)); }
        );
      });

      slots.inject("settings.section", function () {
        return slots.register(
          { name: "settings.section", id: "kullanim-settings", order: 30, label: function () { return "Usage"; } },
          function () { return el(UsagePanel, null); }
        );
      });

      slots.inject("conversation.chat.assistant-actions", function () {
        return slots.register(
          { name: "conversation.chat.assistant-actions", id: "kullanim-token", order: 8 },
          function (props) { return el(TokenAction, props || {}); }
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
