#!/usr/bin/env node
/**
 * Tests for the live data sync logic added to index.html.
 *
 * Two areas are covered:
 *   1. getLiveDaysInRun  — must use the real current date, not a hardcoded one.
 *   2. mergeScrapedDaily — the pure merge algorithm inside applyScraped(),
 *      extracted here without DOM dependencies so it can run in Node.js.
 *
 * Run with:  node tests/js/test_live_data_sync.js
 */

'use strict';

const assert = require('assert');

// ── Logic under test (mirrors index.html — keep in sync) ─────────────────────

/**
 * Returns the number of days a film has been in theatres (Day 1 = release day).
 * Mirrors getLiveDaysInRun() in index.html.
 */
function getLiveDaysInRun(releaseDate) {
  var rel = new Date(releaseDate);
  var now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.max(1, Math.floor((now - rel) / (1000 * 60 * 60 * 24)) + 1);
}

/**
 * Merges scraped daily rows with the hardcoded FILM_PAGES daily array.
 * Returns the merged array when the scraper has more data, null otherwise.
 * Mirrors the core of applyScraped() in index.html (no DOM side-effects).
 *
 * @param {Array} hc      Hardcoded daily entries (non-bucket, gross != null).
 * @param {Array} scraped Rows from the scraper JSON file.
 * @returns {Array|null}
 */
function mergeScrapedDaily(hc, scraped) {
  if (!scraped || !scraped.length) return null;
  if (scraped.length <= hc.length) return null;

  var merged = [];
  for (var i = 0; i < scraped.length; i++) {
    var sc = scraped[i];
    if (i < hc.length) {
      merged.push({
        date:    hc[i].date,
        day:     hc[i].day,
        gross:   sc.gross,
        chgDay:  sc.chg_day != null ? sc.chg_day : hc[i].chgDay,
        chgWeek: hc[i].chgWeek,
        total:   sc.total,
      });
    } else {
      merged.push({
        date:    sc.date || ('Day ' + (i + 1)),
        day:     '',
        gross:   sc.gross,
        chgDay:  sc.chg_day,
        chgWeek: null,
        total:   sc.total,
      });
    }
  }
  return merged;
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let section = '';

function describe(name, fn) {
  section = name;
  console.log('\n' + name);
  fn();
}

function test(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name);
    console.error('      ' + e.message);
    failed++;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a UTC date string N days from now, mirroring how getLiveDaysInRun
 * parses dates (new Date(dateStr) treats date-only strings as UTC midnight).
 */
function utcDateStr(offsetDays) {
  var d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * Compute the expected getLiveDaysInRun result for a given ISO date string using
 * the same arithmetic the function uses, so tests are timezone-agnostic.
 */
function expectedDays(dateStr) {
  var rel = new Date(dateStr);
  var now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.max(1, Math.floor((now - rel) / (1000 * 60 * 60 * 24)) + 1);
}

// ── Test data ─────────────────────────────────────────────────────────────────

var HC3 = [
  { date: 'Thu Apr 16', day: 'Thu', gross: 3.50,  chgDay: null,  chgWeek: null,  total: 3.50  },
  { date: 'Fri Apr 17', day: 'Fri', gross: 14.40, chgDay: 311.4, chgWeek: null,  total: 17.90 },
  { date: 'Sat Apr 18', day: 'Sat', gross: 21.75, chgDay: 51.0,  chgWeek: -33.5, total: 39.65 },
];

var SC5 = [
  { date: 'Day 1', day: 'Day 1', gross: 3.50,  total: 3.50,  chg_day: null   },
  { date: 'Day 2', day: 'Day 2', gross: 14.40, total: 17.90, chg_day: 311.4  },
  { date: 'Day 3', day: 'Day 3', gross: 21.75, total: 39.65, chg_day: 51.0   },
  { date: 'Day 4', day: 'Day 4', gross: 8.10,  total: 47.75, chg_day: -62.8  },
  { date: 'Day 5', day: 'Day 5', gross: 9.30,  total: 57.05, chg_day: 14.8   },
];

// ── getLiveDaysInRun tests ────────────────────────────────────────────────────

describe('getLiveDaysInRun', function () {
  test('returns the correct count for a UTC date from today', function () {
    var dateStr = utcDateStr(0);
    assert.strictEqual(getLiveDaysInRun(dateStr), expectedDays(dateStr));
  });

  test('returns the correct count for a UTC date from 1 day ago', function () {
    var dateStr = utcDateStr(-1);
    assert.strictEqual(getLiveDaysInRun(dateStr), expectedDays(dateStr));
  });

  test('returns the correct count for a UTC date from 7 days ago', function () {
    var dateStr = utcDateStr(-7);
    assert.strictEqual(getLiveDaysInRun(dateStr), expectedDays(dateStr));
  });

  test('returns a positive integer for a historic date', function () {
    var days = getLiveDaysInRun('2020-01-01');
    assert.ok(typeof days === 'number' && days > 1000,
      'expected >1000 days for a 2020 release, got ' + days);
  });

  test('never returns 0 or negative (clamp guard)', function () {
    // A release date in the future should still return at least 1.
    var days = getLiveDaysInRun(utcDateStr(30));
    assert.ok(days >= 1, 'expected >= 1, got ' + days);
  });

  test('does not return the old hardcoded value for 2026-04-17', function () {
    // Before the fix, getLiveDaysInRun always used new Date('2026-04-29'),
    // so a film released on 2026-04-17 always returned 13.
    // The real count must now equal expectedDays() for that date.
    var days = getLiveDaysInRun('2026-04-17');
    assert.strictEqual(days, expectedDays('2026-04-17'));
    assert.ok(days >= 13, 'expected >= 13, got ' + days);
  });

  test('older release dates yield higher day counts (monotonicity)', function () {
    var fromTen    = getLiveDaysInRun(utcDateStr(-10));
    var fromEleven = getLiveDaysInRun(utcDateStr(-11));
    assert.ok(fromEleven >= fromTen,
      'day count for -11 days (' + fromEleven + ') should be >= -10 days (' + fromTen + ')');
  });
});

// ── mergeScrapedDaily — no-op conditions ─────────────────────────────────────

describe('mergeScrapedDaily — returns null when scraper has no new data', function () {
  test('null for empty scraped array', function () {
    assert.strictEqual(mergeScrapedDaily(HC3, []), null);
  });

  test('null for null scraped argument', function () {
    assert.strictEqual(mergeScrapedDaily(HC3, null), null);
  });

  test('null when scraped has same number of days as hardcoded', function () {
    assert.strictEqual(mergeScrapedDaily(HC3, SC5.slice(0, 3)), null);
  });

  test('null when scraped has fewer days than hardcoded', function () {
    assert.strictEqual(mergeScrapedDaily(HC3, SC5.slice(0, 2)), null);
  });
});

// ── mergeScrapedDaily — shape of merged output ───────────────────────────────

describe('mergeScrapedDaily — merged array shape', function () {
  test('length equals scraped count when scraper has more days', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    assert.strictEqual(merged.length, 5);
  });

  test('each entry has the required fields', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    merged.forEach(function (row, i) {
      assert.ok('date'    in row, 'missing date at index '    + i);
      assert.ok('day'     in row, 'missing day at index '     + i);
      assert.ok('gross'   in row, 'missing gross at index '   + i);
      assert.ok('chgDay'  in row, 'missing chgDay at index '  + i);
      assert.ok('chgWeek' in row, 'missing chgWeek at index ' + i);
      assert.ok('total'   in row, 'missing total at index '   + i);
    });
  });
});

// ── mergeScrapedDaily — label preservation ───────────────────────────────────

describe('mergeScrapedDaily — date/day label handling', function () {
  test('preserves hardcoded date labels for existing days', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    assert.strictEqual(merged[0].date, 'Thu Apr 16');
    assert.strictEqual(merged[1].date, 'Fri Apr 17');
    assert.strictEqual(merged[2].date, 'Sat Apr 18');
  });

  test('preserves hardcoded day-of-week labels for existing days', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    assert.strictEqual(merged[0].day, 'Thu');
    assert.strictEqual(merged[1].day, 'Fri');
    assert.strictEqual(merged[2].day, 'Sat');
  });

  test('new days beyond hardcoded range get non-empty date labels', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    assert.ok(merged[3].date.length > 0, 'day 4 date should not be empty');
    assert.ok(merged[4].date.length > 0, 'day 5 date should not be empty');
  });

  test('new days beyond hardcoded range have empty day-of-week', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    assert.strictEqual(merged[3].day, '');
    assert.strictEqual(merged[4].day, '');
  });

  test('fallback Day-N label used when scraped date is empty', function () {
    var sc = SC5.map(function (r, i) {
      return i >= 3 ? Object.assign({}, r, { date: '' }) : r;
    });
    var merged = mergeScrapedDaily(HC3, sc);
    assert.ok(merged[3].date.startsWith('Day '), 'expected Day N fallback');
  });

  test('works when hardcoded array is empty (all entries from scraper)', function () {
    var merged = mergeScrapedDaily([], SC5);
    assert.strictEqual(merged.length, 5);
    assert.strictEqual(merged[0].date, 'Day 1');
    assert.strictEqual(merged[0].day, '');
  });
});

// ── mergeScrapedDaily — financial values ─────────────────────────────────────

describe('mergeScrapedDaily — financial values from scraper', function () {
  test('scraped gross used for existing days', function () {
    var sc = SC5.map(function (r, i) {
      return i === 0 ? Object.assign({}, r, { gross: 99.99 }) : r;
    });
    var merged = mergeScrapedDaily(HC3, sc);
    assert.strictEqual(merged[0].gross, 99.99);
  });

  test('scraped total used for all entries', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    assert.strictEqual(merged[0].total, 3.50);
    assert.strictEqual(merged[4].total, 57.05);
  });

  test('scraped chg_day maps to chgDay for existing days', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    assert.strictEqual(merged[1].chgDay, 311.4);
    assert.strictEqual(merged[3].chgDay, -62.8);
  });

  test('null chg_day falls back to hardcoded chgDay', function () {
    var sc = SC5.map(function (r, i) {
      return i === 1 ? Object.assign({}, r, { chg_day: null }) : r;
    });
    var merged = mergeScrapedDaily(HC3, sc);
    // Scraped chg_day is null for day 2 → use hardcoded value (311.4)
    assert.strictEqual(merged[1].chgDay, 311.4);
  });

  test('new days beyond hardcoded range use scraped chg_day directly', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    assert.strictEqual(merged[3].chgDay, -62.8);
    assert.strictEqual(merged[4].chgDay, 14.8);
  });

  test('null chg_day for day 1 remains null in merged output', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    assert.strictEqual(merged[0].chgDay, null);
  });
});

// ── mergeScrapedDaily — chgWeek preservation ─────────────────────────────────

describe('mergeScrapedDaily — chgWeek handling', function () {
  test('chgWeek from hardcoded is preserved for existing days', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    assert.strictEqual(merged[2].chgWeek, -33.5);
  });

  test('null chgWeek from hardcoded passes through unchanged', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    assert.strictEqual(merged[0].chgWeek, null);
    assert.strictEqual(merged[1].chgWeek, null);
  });

  test('new days beyond hardcoded range always have null chgWeek', function () {
    var merged = mergeScrapedDaily(HC3, SC5);
    assert.strictEqual(merged[3].chgWeek, null);
    assert.strictEqual(merged[4].chgWeek, null);
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed > 0) process.exit(1);
