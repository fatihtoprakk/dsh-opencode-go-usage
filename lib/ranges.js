/**
 * Small, dependency-free helpers shared by the host half.
 *
 * Kept separate from lib/index.js so they can be unit-tested without a DSH
 * runtime: index.js needs `ctx`, a web server and a live profile to load.
 */

/**
 * Coerce an untrusted numeric field into a safe integer range.
 *
 * Paging values arrive over HTTP, so they can be strings, floats, negative,
 * NaN, null or absurdly large. Anything unusable falls back rather than
 * throwing, and the result is always a safe integer inside [min, max].
 *
 * Note: `null`, `''` and `false` coerce to 0 in JavaScript rather than NaN.
 * Treating those as "absent" matters because `Number(null) === 0` would
 * otherwise clamp a missing limit down to `min` instead of using the intended
 * default — a caller sending `{"limit": null}` would silently get one row.
 */
export function clampInt(value, fallback, min, max) {
  if (value === null || value === undefined || value === '' || value === false) return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/**
 * Slice one page out of a sorted list.
 *
 * `fallbackLimit` and `maxLimit` are required. They are validated rather than
 * defaulted because a missing bound previously produced `Math.min(undefined, x)`
 * -> NaN -> `slice(0, NaN)` -> a silently empty page with hasMore still true,
 * which is a hang waiting to happen in a pager loop.
 *
 * @returns {{records:Array,offset:number,limit:number,hasMore:boolean}}
 */
export function paginate(rows, offset, limit, fallbackLimit, maxLimit) {
  if (!Number.isFinite(maxLimit) || maxLimit < 1) {
    throw new TypeError('paginate: maxLimit must be a finite number >= 1')
  }
  const fallback = Number.isFinite(fallbackLimit) ? fallbackLimit : maxLimit
  const size = clampInt(limit, fallback, 1, maxLimit)
  const start = clampInt(offset, 0, 0, rows.length)
  const page = rows.slice(start, start + size)
  return {
    records: page,
    offset: start,
    limit: size,
    hasMore: start + page.length < rows.length
  }
}
