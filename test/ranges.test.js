/**
 * Tests for the paging helpers.
 *
 * Paging values arrive over HTTP from the client, so every one of them is
 * untrusted input: strings, floats, negative numbers, NaN or absurdly large.
 * These tests pin the coercion and the page boundaries.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { clampInt, paginate } from '../lib/ranges.js'

const DEFAULT = 50
const MAX = 500

test('clampInt falls back for unusable values', () => {
  assert.equal(clampInt(undefined, DEFAULT, 1, MAX), DEFAULT)
  assert.equal(clampInt('abc', DEFAULT, 1, MAX), DEFAULT)
  assert.equal(clampInt(NaN, DEFAULT, 1, MAX), DEFAULT)
  assert.equal(clampInt(Infinity, DEFAULT, 1, MAX), DEFAULT)
})

test('absent-looking values use the default, not the minimum', () => {
  // Number(null) === 0, so without an explicit check a null limit would clamp
  // down to min and silently return one row instead of the default page.
  for (const absent of [null, '', false]) {
    assert.equal(clampInt(absent, DEFAULT, 1, MAX), DEFAULT, `clampInt(${JSON.stringify(absent)})`)
  }
})

test('an explicit zero limit is still clamped to the minimum', () => {
  // 0 is a real (if useless) request, unlike null/undefined, so it must not
  // be treated as absent.
  assert.equal(clampInt(0, DEFAULT, 1, MAX), 1)
})

test('clampInt enforces the range', () => {
  assert.equal(clampInt(-5, DEFAULT, 1, MAX), 1)
  assert.equal(clampInt(99_999, DEFAULT, 1, MAX), MAX)
  assert.equal(clampInt(0, DEFAULT, 1, MAX), 1, 'zero is below the minimum')
})

test('clampInt accepts numeric strings and truncates floats', () => {
  assert.equal(clampInt('100', DEFAULT, 1, MAX), 100)
  assert.equal(clampInt(50.9, DEFAULT, 1, MAX), 50)
  assert.equal(clampInt(-0.5, DEFAULT, 0, MAX), 0, 'truncation moves toward zero')
})

test('paginate slices the requested window', () => {
  const rows = Array.from({ length: 174 }, (_, i) => i)

  const first = paginate(rows, 0, 50, DEFAULT, MAX)
  assert.equal(first.records.length, 50)
  assert.equal(first.records[0], 0)
  assert.equal(first.offset, 0)
  assert.equal(first.hasMore, true)

  const second = paginate(rows, 50, 50, DEFAULT, MAX)
  assert.equal(second.records[0], 50)
  assert.equal(second.hasMore, true)
})

test('the final page is short and reports hasMore false', () => {
  const rows = Array.from({ length: 174 }, (_, i) => i)
  const last = paginate(rows, 150, 50, DEFAULT, MAX)
  assert.equal(last.records.length, 24)
  assert.equal(last.hasMore, false)
  assert.equal(last.records[last.records.length - 1], 173)
})

test('an offset at or past the end yields an empty page, not an error', () => {
  const rows = [1, 2, 3]
  for (const offset of [3, 4, 1_000_000]) {
    const p = paginate(rows, offset, 50, DEFAULT, MAX)
    assert.deepEqual(p.records, [])
    assert.equal(p.hasMore, false)
  }
})

test('a negative offset is clamped to the start', () => {
  const rows = [1, 2, 3]
  const p = paginate(rows, -10, 2, DEFAULT, MAX)
  assert.deepEqual(p.records, [1, 2])
  assert.equal(p.offset, 0)
})

test('a missing limit uses the default and never exceeds the maximum', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => i)
  assert.equal(paginate(rows, 0, undefined, DEFAULT, MAX).records.length, DEFAULT)
  assert.equal(paginate(rows, 0, 10_000, DEFAULT, MAX).records.length, MAX)
})

test('hasMore is false when the page ends exactly on the last row', () => {
  const rows = Array.from({ length: 100 }, (_, i) => i)
  const p = paginate(rows, 50, 50, DEFAULT, MAX)
  assert.equal(p.records.length, 50)
  assert.equal(p.hasMore, false, '100 rows, offset 50 limit 50 -> exactly the end')
})

test('paging with an empty list is safe', () => {
  const p = paginate([], 0, 50, DEFAULT, MAX)
  assert.deepEqual(p.records, [])
  assert.equal(p.hasMore, false)
  assert.equal(p.offset, 0)
})

test('paginate rejects a missing or invalid maxLimit instead of returning junk', () => {
  // Without this guard, Math.min(undefined, x) -> NaN -> slice(0, NaN) returns
  // an empty page while hasMore stays true: a pager loop that never ends.
  const rows = [1, 2, 3]
  assert.throws(() => paginate(rows, 0, 50, 50, undefined), /maxLimit/)
  assert.throws(() => paginate(rows, 0, 50, 50, 0), /maxLimit/)
  assert.throws(() => paginate(rows, 0, 50, 50, NaN), /maxLimit/)
})

test('a missing fallbackLimit falls back to maxLimit', () => {
  const rows = Array.from({ length: 100 }, (_, i) => i)
  const p = paginate(rows, 0, undefined, undefined, 25)
  assert.equal(p.records.length, 25)
  assert.equal(p.limit, 25)
})
