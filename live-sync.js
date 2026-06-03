**
 * live-sync.js v5 - resilient auto-load of scraped daily data
 * - Calendar-safe date math
 * - Token-based film matching
 * - Robust slug fallback and merge handling
 */
(function () {
  var DEBUG = true;

  function log() {
    if (DEBUG && typeof console !== 'undefined' && console && console.log) {
      console.log.apply(console, ['[live-sync]'].concat(Array.prototype.slice.call(arguments)));
    }
  }

  function warn() {
    if (typeof console !== 'undefined' && console && console.warn) {
      console.warn.apply(console, ['[live-sync]'].concat(Array.prototype.slice.call(arguments)));
    }
  }

  function isArray(value) {
    return Object.prototype.toString.call(value) === '[object Array]';
  }

  function toNumber(value) {
    if (value == null || value === '') return null;
    var n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  function norm(value) {
    return (value || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function tokens(value) {
    return (value || '')
      .toString()
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function slugify(value) {
    return (value || '')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function parseDateOnly(value) {
    if (!value) return null;
    var str = String(value).trim();
    var d = /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(str + 'T00:00:00Z') : new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function isPlaceholderLabel(label) {
    var str = (label || '').toString().trim().toLowerCase();
    return !str || /^day\s*\d+$/.test(str) || str === 'tba' || str === 'tbd' || str === 'pending';
  }

  function rowText(row) {
    if (!row) return '';
    return [row.date, row.day, row.label, row.bucket, row.title, row.name, row.note].filter(Boolean).join(' ');
  }

  function firstToken(value) {
    var str = (value || '').toString().trim();
    return str ? str.split(/\s+/)[0] : '';
  }

  function isPreviewLikeRow(row) {
    var text = rowText(row).toLowerCase();
    return /preview/.test(text) || /\bday\s*0\b/.test(text);
  }

  function extractDayOffset(row, fallbackIndex) {
    if (!row) return fallbackIndex;

    var text = rowText(row).toLowerCase();
    var previewMatch = text.match(/\bday\s*0\b/);
    if (previewMatch || /preview/.test(text)) return -1;

    var dayMatch = text.match(/\bday\s*(\d+)\b/);
    if (dayMatch) return Math.max(0, parseInt(dayMatch[1], 10) - 1);

    return fallbackIndex;
  }

  function labelFromRow(releaseDate, row, fallbackIndex) {
    var rawDate = row && row.date ? String(row.date).trim() : '';
    var rawDay = row && row.day ? String(row.day).trim() : '';
    var hasExplicitDate = rawDate && !isPlaceholderLabel(rawDate) && !/^day\s*\d+$/i.test(rawDate) && !/preview/i.test(rawDate);

    if (hasExplicitDate) {
      return {
        date: rawDate,
        day: !isPlaceholderLabel(rawDay) && !/^day\s*\d+$/i.test(rawDay) ? rawDay : firstToken(rawDate),
      };
    }

    var dayIndex = extractDayOffset(row, fallbackIndex);
    var computed = computeDateLabel(releaseDate, dayIndex);

    return {
      date: computed.date,
      day: !isPlaceholderLabel(rawDay) && !/^day\s*\d+$/i.test(rawDay) ? rawDay : computed.day,
    };
  }

  function buildSyntheticPreviewRow(config) {
    if (!config || !config.preview) return null;

    var previewGross = toNumber(config.preview.gross);
    var previewDate = computeDateLabel(config.releaseDate, -1);

    return {
      label: config.preview.label || 'Day 0',
      date: previewDate.date,
      day: previewDate.day,
      gross: previewGross != null ? round2(previewGross) : null,
      chgDay: null,
      chgWeek: null,
      total: previewGross != null ? round2(previewGross) : null,
      __syntheticPreview: true,
    };
  }

  function hasPreviewTag(row) {
    var text = rowText(row).toLowerCase();
    return /\bday\s*0\b/.test(text) || /preview/.test(text);
  }

  function hasToken(list, token) {
    return list.indexOf(token) !== -1;
  }

  function hasAnyToken(list, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      if (hasToken(list, candidates[i])) return true;
    }
    return false;
  }

  log('v5 initializing...');

  // ── 1. Check globals ─────────────────────────────────────────────────────
  var hasFILM_PAGES = typeof FILM_PAGES !== 'undefined';
  var hasLIVE_FILMS = typeof LIVE_FILMS !== 'undefined';
  var hasFILMS = typeof FILMS !== 'undefined';
  var hasRenderLive = typeof renderLiveTracker === 'function';
  var hasRenderYr = typeof renderYrTable === 'function';
  var hasGetLiveDays = typeof getLiveDaysInRun === 'function';

  log('Globals:', {
    FILM_PAGES: hasFILM_PAGES,
    LIVE_FILMS: hasLIVE_FILMS,
    FILMS: hasFILMS,
    renderLiveTracker: hasRenderLive,
    renderYrTable: hasRenderYr,
  });
  if (hasFILM_PAGES) log('FILM_PAGES keys:', Object.keys(FILM_PAGES));
  if (hasLIVE_FILMS) log('LIVE_FILMS keys:', Object.keys(LIVE_FILMS));

  // ── 2. Fix getLiveDaysInRun ───────────────────────────────────────────────
  if (hasGetLiveDays) {
    window.getLiveDaysInRun = function (releaseDate) {
      var rel = parseDateOnly(releaseDate);
      if (!rel) return 1;

      var now = new Date();
      var releaseUTC = Date.UTC(rel.getUTCFullYear(), rel.getUTCMonth(), rel.getUTCDate());
      var todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

      return Math.max(1, Math.floor((todayUTC - releaseUTC) / 86400000) + 1);
    };
    log('Patched getLiveDaysInRun');
  }

  // ── 3. Date helpers ───────────────────────────────────────────────────────
  var DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function computeDateLabel(releaseDate, dayIndex) {
    var rel = parseDateOnly(releaseDate);
    if (!rel) return { date: '', day: '' };

    var d = new Date(rel.getTime());
    d.setUTCDate(d.getUTCDate() + dayIndex);

    var dayName = DAY_SHORT[d.getUTCDay()];
    var monName = MON_SHORT[d.getUTCMonth()];
    var dateNum = d.getUTCDate();

    return { date: dayName + ' ' + monName + ' ' + dateNum, day: dayName };
  }

  // ── 4. Fuzzy key matcher ──────────────────────────────────────────────────
  function findLiveFilmKey(fpKey) {
    if (!hasLIVE_FILMS) return null;
    if (LIVE_FILMS[fpKey]) return fpKey;

    var fpNorm = norm(fpKey);
    var fpSlug = slugify(fpKey);
    var liveKeys = Object.keys(LIVE_FILMS);

    for (var i = 0; i < liveKeys.length; i++) {
      var lk = liveKeys[i];
      var lf = LIVE_FILMS[lk] || {};
      var lkNorm = norm(lk);

      if (lkNorm === fpNorm) return lk;
      if (slugify(lk) === fpSlug) return lk;
      if (lf.title && norm(lf.title) === fpNorm) return lk;
      if (lf.name && norm(lf.name) === fpNorm) return lk;

      if (fpNorm.length > 3 && lkNorm.indexOf(fpNorm) !== -1) return lk;
      if (fpNorm.length > 3 && fpNorm.indexOf(lkNorm) !== -1) return lk;
    }

    return null;
  }

  function findFilmsIndex(key) {
    if (!hasFILMS) return -1;

    var keyNorm = norm(key);
    var keySlug = slugify(key);

    for (var i = 0; i < FILMS.length; i++) {
      var f = FILMS[i] || {};
      var candidates = [f.title, f.id, f.key, f.slug, f.name];

      for (var j = 0; j < candidates.length; j++) {
        var candidate = candidates[j];
        if (!candidate) continue;
        if (norm(candidate) === keyNorm) return i;
        if (slugify(candidate) === keySlug) return i;
      }
    }

    return -1;
  }

  // ── 5. Film config with release dates and slug variants ──────────────────
  function matchDhurandhar(key) {
    var n = norm(key);
    var t = tokens(key);
    return n.indexOf('dhurandhar') !== -1 && !hasAnyToken(t, ['2', 'part2', 'second']);
  }

  function matchDhurandhar2(key) {
    var n = norm(key);
    var t = tokens(key);
    return n.indexOf('dhurandhar') !== -1 && (n.indexOf('dhurandhar2') !== -1 || hasAnyToken(t, ['2', 'part2', 'second']));
  }

  function matchBangla(key) {
    var n = norm(key);
    var t = tokens(key);
    return n.indexOf('bhooth') !== -1 || n.indexOf('bhoot') !== -1 || hasAnyToken(t, ['bangla', 'bhangla']);
  }

  var FILM_CONFIG = [
    {
      name: 'Dhurandhar',
      releaseDate: '2025-12-05',
      slugs: ['Dhurandhar-2025', 'Dhurandhar_2025'],
      match: matchDhurandhar,
    },
    {
      name: 'Dhurandhar 2',
      releaseDate: '2026-03-19',
      previewDays: 1,
      preview: { label: 'Day 0', gross: 43 },
      slugs: ['Dhurandhar2-2026', 'Dhurandhar_2_2026'],
      match: matchDhurandhar2,
    },
    {
      name: 'Bhooth Bangla',
      releaseDate: '2026-04-17',
      previewDays: 1,
      preview: { label: 'Day 0', gross: 3.75 },
      slugs: [
        'BhoothBangla-2026',
        'Bhooth_Bangla_2026',
        'BhootBhangla-2025',
        'Bhoot_Bhangla_2025',
        'BhoothBangla-2025',
        'Bhooth_Bangla_2025',
        'BhootBangla-2026',
        'Bhoot_Bangla_2026',
      ],
      match: matchBangla,
    },
  ];

  var keysToFetch = [];
  var fpKeys = hasFILM_PAGES ? Object.keys(FILM_PAGES) : [];

  FILM_CONFIG.forEach(function (cfg) {
    for (var i = 0; i < fpKeys.length; i++) {
      if (cfg.match(fpKeys[i])) {
        keysToFetch.push({ fpKey: fpKeys[i], config: cfg });
        log('Matched "' + cfg.name + '" -> FILM_PAGES["' + fpKeys[i] + '"]');
        break;
      }
    }
  });

  log('Films to sync:', keysToFetch.length);

  if (keysToFetch.length === 0) {
    warn('No FILM_PAGES keys matched. Check FILM_CONFIG patterns.');
    updateTimestamp();
    if (hasRenderLive) renderLiveTracker();
    return;
  }

  var remaining = keysToFetch.length;

  function onAllDone() {
    if (--remaining > 0) return;

    log('All fetches complete. Re-rendering...');

    if (hasRenderLive) {
      try {
        renderLiveTracker();
      } catch (e) {
        warn('renderLiveTracker error:', e);
      }
    }

    if (hasRenderYr) {
      try {
        renderYrTable();
      } catch (e2) {
        warn('renderYrTable error:', e2);
      }
    }

    updateTimestamp();
    log('Sync complete');
  }

  // ── 7. Update "Last updated" text ─────────────────────────────────────────
  function updateTimestamp() {
    var d = new Date();
    var text =
      'Last updated: ' +
      DAY_LONG[d.getDay()] +
      ', ' +
      d.getDate() +
      ' ' +
      MON_LONG[d.getMonth()] +
      ' ' +
      d.getFullYear() +
      ' · Figures are India nett in ₹ Crore · Click any card to open full film page';

    var metaEl = document.getElementById('live-updated-meta');
    if (metaEl) {
      metaEl.textContent = text;
      return;
    }

    var section = document.getElementById('live-tracker-section');
    if (section) {
      var allEls = section.querySelectorAll('*');
      for (var i = 0; i < allEls.length; i++) {
        if (allEls[i].childNodes.length <= 3 && allEls[i].textContent.indexOf('Last updated') !== -1) {
          allEls[i].textContent = text;
          return;
        }
      }
    }

    var allP = document.querySelectorAll('p, div, span');
    for (var j = 0; j < allP.length; j++) {
      if (allP[j].textContent.indexOf('Last updated:') !== -1 && allP[j].textContent.indexOf('India nett') !== -1) {
        allP[j].textContent = text;
        return;
      }
    }
  }

  // ── 8. Core merge and apply logic ────────────────────────────────────────
  function applyScraped(fpKey, scraped, config) {
    if (!hasFILM_PAGES) return;

    var fp = FILM_PAGES[fpKey];
    if (!fp) return;

    var scrapedRows = isArray(scraped) ? scraped : [];
    log('Applying "' + config.name + '" -> FILM_PAGES["' + fpKey + '"]:', scrapedRows.length, 'scraped days');

    var hardcodedRows = isArray(fp.daily) ? fp.daily.filter(function (d) {
      return d && d.gross != null;
    }) : [];

    log('  Hardcoded:', hardcodedRows.length, '| Scraped:', scrapedRows.length);

    var hasPreviewRow = false;
    for (var p = 0; p < hardcodedRows.length; p++) {
      if (hasPreviewTag(hardcodedRows[p])) { hasPreviewRow = true; break; }
    }
    if (!hasPreviewRow) {
      for (var q = 0; q < scrapedRows.length; q++) {
        if (hasPreviewTag(scrapedRows[q])) { hasPreviewRow = true; break; }
      }
    }
    var syntheticPreview = !hasPreviewRow && config.preview ? buildSyntheticPreviewRow(config) : null;
    if (hasPreviewRow) log('  Preview row detected, preserving Day 0 alignment');
    if (syntheticPreview) log('  Injecting synthetic preview row for ' + config.name + ' (' + syntheticPreview.date + ')');

    var merged = syntheticPreview ? [syntheticPreview] : [];
    var loopStart = syntheticPreview ? 1 : 0;
    var maxLen = loopStart + Math.max(hardcodedRows.length, scrapedRows.length);
    var runningTotal = 0;

    for (var i = loopStart; i < maxLen; i++) {
      var sourceIndex = i - loopStart;
      var sc = sourceIndex >= 0 && sourceIndex < scrapedRows.length ? scrapedRows[sourceIndex] : null;
      var hcRow = sourceIndex >= 0 && sourceIndex < hardcodedRows.length ? hardcodedRows[sourceIndex] : null;
      var previewSource = hasPreviewTag(sc) ? sc : (hasPreviewTag(hcRow) ? hcRow : null);
      var labelSource = previewSource || hcRow || sc;
      var realDate = labelFromRow(config.releaseDate, labelSource, sourceIndex);

      var scGross = sc ? toNumber(sc.gross) : null;
      var hcGross = hcRow ? toNumber(hcRow.gross) : null;
      var gross = scGross != null ? scGross : hcGross;

      var scTotal = sc ? toNumber(sc.total) : null;
      var hcTotal = hcRow ? toNumber(hcRow.total) : null;
      var total = scTotal != null ? scTotal : hcTotal;

      if (total == null && gross != null) {
        total = round2(runningTotal + gross);
      }
      if (total == null) {
        total = runningTotal;
      }

      var hcDate = hcRow ? hcRow.date : null;
      var hcDay = hcRow ? hcRow.day : null;
      var useHardcodedDate = hcDate && !isPlaceholderLabel(hcDate) && !/^day\s*\d+$/i.test(String(hcDate));

      var entry = {
        date: useHardcodedDate ? hcDate : realDate.date,
        day: useHardcodedDate ? (hcDay && !/^day\s*\d+$/i.test(String(hcDay)) ? hcDay : realDate.day) : realDate.day,
        gross: gross != null ? round2(gross) : gross,
        chgDay: sc && sc.chg_day != null ? sc.chg_day : (hcRow && hcRow.chgDay != null ? hcRow.chgDay : null),
        chgWeek: hcRow && hcRow.chgWeek != null ? hcRow.chgWeek : null,
        total: total != null ? round2(total) : null,
      };

      if (entry.total != null) runningTotal = entry.total;
      merged.push(entry);
    }

    log('  Merged:', merged.length, 'entries, running total:', runningTotal);

    if (merged.length > hardcodedRows.length) {
      var sample = merged.slice(hardcodedRows.length, hardcodedRows.length + 3).map(function (e) {
        return e.date;
      });
      log('  New date labels (first 3 beyond hardcoded):', sample);
    }

    fp.daily = merged;

    var newIndia = Math.max(runningTotal, fp.india || 0);
    fp.india = round2(newIndia);
    log('  fp.india:', fp.india);

    if (fp.prediction && fp.prediction.actuals) {
      fp.prediction.actuals.running_total = fp.india;

      var w1 = 0;
      for (var j = 0; j < Math.min(7, merged.length); j++) {
        w1 += toNumber(merged[j].gross) || 0;
      }
      fp.prediction.actuals.week1 = round2(w1);
    }

    var liveKey = findLiveFilmKey(fpKey) || findLiveFilmKey(config.name);
    if (liveKey) {
      var lf = LIVE_FILMS[liveKey];
      lf.indiaRunning = fp.india;

      if (scrapedRows.length > 0) {
        var lastScrapedGross = toNumber(scrapedRows[scrapedRows.length - 1].gross);
        lf.yesterdayIndia = lastScrapedGross != null ? round2(lastScrapedGross) : lf.yesterdayIndia;
      }

      if (lf.daily) lf.daily = merged;
      log('  Live film updated:', liveKey);
    } else {
      warn('  No LIVE_FILMS match for "' + fpKey + '"');
    }

    var fi = findFilmsIndex(fpKey);
    if (fi !== -1 && fp.india > (FILMS[fi].india || 0)) {
      FILMS[fi].india = fp.india;
      log('  FILMS[' + fi + '] updated');
    }

    var el = document.getElementById('page-film-' + fpKey);
    if (el) {
      try {
        el.parentNode.removeChild(el);
        if (typeof showFilmPageWithPredictions === 'function' && fp.prediction) showFilmPageWithPredictions(fpKey);
        else if (typeof showFilmPage === 'function') showFilmPage(fpKey);
      } catch (e) {
        warn('Film page re-render failed:', e);
      }
    }
  }

  // ── 9. Fetch with fallback slug variants ──────────────────────────────────
  function fetchWithFallbacks(item, slugIndex) {
    var slugs = item.config.slugs || [];
    if (slugIndex >= slugs.length) {
      warn('All slugs failed for "' + item.config.name + '"');
      onAllDone();
      return;
    }

    var slug = slugs[slugIndex];
    var url = 'scraper/output/' + slug + '.json';
    log('Fetching', url);

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (scraped) {
        try {
          var rows = isArray(scraped) ? scraped : (scraped && isArray(scraped.daily) ? scraped.daily : []);
          if (rows.length) {
            log('✓', slug + '.json:', rows.length, 'days');
            applyScraped(item.fpKey, rows, item.config);
          } else {
            warn('Empty or unsupported payload in', slug + '.json');
          }
        } catch (processErr) {
          warn('Processing error for', slug + '.json:', processErr);
        }

        onAllDone();
      })
      .catch(function (err) {
        log('✗', slug + '.json:', err.message);
        fetchWithFallbacks(item, slugIndex + 1);
      });
  }

  // ── 10. Kick off ──────────────────────────────────────────────────────────
  keysToFetch.forEach(function (item) {
    fetchWithFallbacks(item, 0);
  });

  log('Initiated fetches for', keysToFetch.length, 'film(s)');
})();
