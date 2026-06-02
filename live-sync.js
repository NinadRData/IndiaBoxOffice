/**
 * live-sync.js v4 — Auto-load scraped daily data from GitHub Actions
 * - Computes real calendar dates from release date (no more "Day 61")
 * - Fuzzy matches LIVE_FILMS keys
 * - Tries multiple slug variants for scraper output files
 */
(function () {
  var DEBUG = true;
  function log() { if (DEBUG && console && console.log) console.log.apply(console, ['[live-sync]'].concat(Array.prototype.slice.call(arguments))); }
  function warn() { if (console && console.warn) console.warn.apply(console, ['[live-sync]'].concat(Array.prototype.slice.call(arguments))); }

  log('v4 initializing...');

  // ── 1. Check globals ─────────────────────────────────────────────────────
  var hasFILM_PAGES  = typeof FILM_PAGES !== 'undefined';
  var hasLIVE_FILMS  = typeof LIVE_FILMS !== 'undefined';
  var hasFILMS       = typeof FILMS !== 'undefined';
  var hasRenderLive  = typeof renderLiveTracker === 'function';
  var hasRenderYr    = typeof renderYrTable === 'function';
  var hasGetLiveDays = typeof getLiveDaysInRun === 'function';

  log('Globals:', { FILM_PAGES: hasFILM_PAGES, LIVE_FILMS: hasLIVE_FILMS, FILMS: hasFILMS,
    renderLiveTracker: hasRenderLive, renderYrTable: hasRenderYr });
  if (hasFILM_PAGES) log('FILM_PAGES keys:', Object.keys(FILM_PAGES));
  if (hasLIVE_FILMS) log('LIVE_FILMS keys:', Object.keys(LIVE_FILMS));

  // ── 2. Fix getLiveDaysInRun ───────────────────────────────────────────────
  if (hasGetLiveDays) {
    window.getLiveDaysInRun = function (releaseDate) {
      var rel = new Date(releaseDate);
      var now = new Date(); now.setHours(0, 0, 0, 0);
      return Math.max(1, Math.floor((now - rel) / (1000 * 60 * 60 * 24)) + 1);
    };
    log('Patched getLiveDaysInRun');
  }

  // ── 3. Date helpers ───────────────────────────────────────────────────────
  var DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAY_LONG  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var MON_LONG  = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

  // Given a release date string and a 0-based day index, return {date, day}
  // e.g. releaseDate='2026-03-19', dayIndex=0 → {date:'Thu Mar 19', day:'Thu'}
  function computeDateLabel(releaseDate, dayIndex) {
    var rel = new Date(releaseDate + 'T00:00:00');
    var d = new Date(rel.getTime() + dayIndex * 86400000);
    var dayName = DAY_SHORT[d.getDay()];
    var monName = MON_SHORT[d.getMonth()];
    var dateNum = d.getDate();
    return { date: dayName + ' ' + monName + ' ' + dateNum, day: dayName };
  }

  // ── 4. Fuzzy key matcher ──────────────────────────────────────────────────
  function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function findLiveFilmKey(fpKey) {
    if (!hasLIVE_FILMS) return null;
    if (LIVE_FILMS[fpKey]) return fpKey;
    var fpNorm = norm(fpKey);
    var liveKeys = Object.keys(LIVE_FILMS);
    for (var i = 0; i < liveKeys.length; i++) {
      var lk = liveKeys[i];
      if (norm(lk) === fpNorm) return lk;
      var lf = LIVE_FILMS[lk];
      if (lf.title && norm(lf.title) === fpNorm) return lk;
      if (lf.name && norm(lf.name) === fpNorm) return lk;
      if (fpNorm.length > 3 && norm(lk).indexOf(fpNorm) !== -1) return lk;
      if (fpNorm.length > 3 && fpNorm.indexOf(norm(lk)) !== -1) return lk;
    }
    return null;
  }

  function findFilmsIndex(key) {
    if (!hasFILMS) return -1;
    var keyNorm = norm(key);
    for (var i = 0; i < FILMS.length; i++) {
      var f = FILMS[i];
      if (norm(f.title) === keyNorm) return i;
      if (f.id && norm(f.id) === keyNorm) return i;
      if (f.key && norm(f.key) === keyNorm) return i;
      var slug = (f.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (slug === key) return i;
    }
    return -1;
  }

  // ── 5. Film config with release dates & slug variants ─────────────────────
  // releaseDate: YYYY-MM-DD (Day 1 of theatrical run)
  // slugs: filenames to try in scraper/output/ (without .json)
  // match: function to match against FILM_PAGES keys

  var FILM_CONFIG = [
    {
      name: 'Dhurandhar',
      releaseDate: '2025-12-05',
      slugs: ['Dhurandhar-2025', 'Dhurandhar_2025'],
      match: function(k) {
        var n = norm(k);
        return n.indexOf('dhurandhar') !== -1 && n.indexOf('2') === -1;
      }
    },
    {
      name: 'Dhurandhar 2',
      releaseDate: '2026-03-19',
      slugs: ['Dhurandhar2-2026', 'Dhurandhar_2_2026'],
      match: function(k) {
        var n = norm(k);
        return n.indexOf('dhurandhar') !== -1 && n.indexOf('2') !== -1;
      }
    },
    {
      name: 'Bhooth Bangla',
      releaseDate: '2026-04-18',
      slugs: ['BhoothBangla-2026', 'Bhooth_Bangla_2026', 'BhootBhangla-2025', 'Bhoot_Bhangla_2025',
              'BhoothBangla-2025', 'Bhooth_Bangla_2025', 'BhootBangla-2026', 'Bhoot_Bangla_2026'],
      match: function(k) {
        var n = norm(k);
        return n.indexOf('bhoot') !== -1 || n.indexOf('bhangla') !== -1 || n.indexOf('bangla') !== -1;
      }
    }
  ];

  // Find matching FILM_PAGES keys for each config entry
  var keysToFetch = []; // {fpKey, config}
  var fpKeys = hasFILM_PAGES ? Object.keys(FILM_PAGES) : [];

  FILM_CONFIG.forEach(function (cfg) {
    for (var i = 0; i < fpKeys.length; i++) {
      if (cfg.match(fpKeys[i])) {
        keysToFetch.push({ fpKey: fpKeys[i], config: cfg });
        log('Matched "' + cfg.name + '" → FILM_PAGES["' + fpKeys[i] + '"]');
        break;
      }
    }
  });

  log('Films to sync:', keysToFetch.length);

  if (keysToFetch.length === 0) {
    warn('No FILM_PAGES keys matched! Check FILM_CONFIG patterns.');
    updateTimestamp();
    if (hasRenderLive) renderLiveTracker();
    return;
  }

  var remaining = keysToFetch.length;

  // ── 6. Callback when all fetches are done ─────────────────────────────────
  function onAllDone() {
    if (--remaining > 0) return;
    log('All fetches complete. Re-rendering...');
    if (hasRenderLive) { try { renderLiveTracker(); } catch(e) { warn('renderLiveTracker error:', e); } }
    if (hasRenderYr)   { try { renderYrTable(); }     catch(e) { warn('renderYrTable error:', e); } }
    updateTimestamp();
    log('✅ Sync complete');
  }

  // ── 7. Update "Last updated" text ─────────────────────────────────────────
  function updateTimestamp() {
    var d = new Date();
    var text = 'Last updated: ' + DAY_LONG[d.getDay()] + ', ' +
               d.getDate() + ' ' + MON_LONG[d.getMonth()] + ' ' + d.getFullYear() +
               ' · Figures are India nett in ₹ Crore · Click any card to open full film page';

    var metaEl = document.getElementById('live-updated-meta');
    if (metaEl) { metaEl.textContent = text; return; }

    var section = document.getElementById('live-tracker-section');
    if (section) {
      var allEls = section.querySelectorAll('*');
      for (var i = 0; i < allEls.length; i++) {
        if (allEls[i].childNodes.length <= 3 && allEls[i].textContent.indexOf('Last updated') !== -1) {
          allEls[i].textContent = text; return;
        }
      }
    }
    var allP = document.querySelectorAll('p, div, span');
    for (var j = 0; j < allP.length; j++) {
      if (allP[j].textContent.indexOf('Last updated:') !== -1 && allP[j].textContent.indexOf('India nett') !== -1) {
        allP[j].textContent = text; return;
      }
    }
  }

  // ── 8. Core merge & apply logic ───────────────────────────────────────────
  function applyScraped(fpKey, scraped, config) {
    if (!hasFILM_PAGES) return;
    var fp = FILM_PAGES[fpKey];
    if (!fp) return;

    log('Applying "' + config.name + '" → FILM_PAGES["' + fpKey + '"]:', scraped.length, 'scraped days');

    var hc = (fp.daily || []).filter(function (d) { return !d.bucket && d.gross != null; });
    log('  Hardcoded:', hc.length, '| Scraped:', scraped.length);

    var merged = [];
    var maxLen = Math.max(hc.length, scraped.length);
    var runningTotal = 0;

    for (var i = 0; i < maxLen; i++) {
      var sc = i < scraped.length ? scraped[i] : null;
      var hcRow = i < hc.length ? hc[i] : null;
      var entry;

      // Compute real calendar date for this day
      var realDate = computeDateLabel(config.releaseDate, i);

      if (hcRow && sc) {
        // Both exist: prefer hardcoded labels if they look real (not "Day N"), else use computed
        var useHcDate = hcRow.date && hcRow.date.indexOf('Day ') !== 0;
        entry = {
          date:    useHcDate ? hcRow.date : realDate.date,
          day:     useHcDate ? (hcRow.day || realDate.day) : realDate.day,
          gross:   sc.gross,
          chgDay:  sc.chg_day != null ? sc.chg_day : (hcRow.chgDay != null ? hcRow.chgDay : null),
          chgWeek: hcRow.chgWeek != null ? hcRow.chgWeek : null,
          total:   sc.total
        };
      } else if (sc) {
        // Only scraped — use computed calendar date
        entry = {
          date:    realDate.date,
          day:     realDate.day,
          gross:   sc.gross,
          chgDay:  sc.chg_day != null ? sc.chg_day : null,
          chgWeek: null,
          total:   sc.total
        };
      } else if (hcRow) {
        // Only hardcoded
        entry = {
          date:    hcRow.date || realDate.date,
          day:     hcRow.day || realDate.day,
          gross:   hcRow.gross,
          chgDay:  hcRow.chgDay != null ? hcRow.chgDay : null,
          chgWeek: hcRow.chgWeek != null ? hcRow.chgWeek : null,
          total:   hcRow.total
        };
      }

      if (entry) {
        runningTotal = entry.total;
        merged.push(entry);
      }
    }

    log('  Merged:', merged.length, 'entries, running total:', runningTotal);

    // Show a sample of the new date labels
    if (merged.length > hc.length) {
      var sample = merged.slice(hc.length, hc.length + 3).map(function(e) { return e.date; });
      log('  New date labels (first 3 beyond hardcoded):', sample);
    }

    // Replace daily array
    fp.daily = merged;

    // Update India net — keep the higher of scraped total vs hardcoded
    var newIndia = Math.max(runningTotal, fp.india || 0);
    fp.india = Math.round(newIndia * 100) / 100;
    log('  fp.india:', fp.india);

    // Sync prediction actuals
    if (fp.prediction && fp.prediction.actuals) {
      fp.prediction.actuals.running_total = fp.india;
      var w1 = 0;
      for (var j = 0; j < Math.min(7, merged.length); j++) w1 += merged[j].gross;
      fp.prediction.actuals.week1 = Math.round(w1 * 100) / 100;
    }

    // Update LIVE_FILMS (fuzzy match)
    var liveKey = findLiveFilmKey(fpKey);
    if (liveKey) {
      var lf = LIVE_FILMS[liveKey];
      lf.indiaRunning = fp.india;
      if (scraped.length > 0) lf.yesterdayIndia = scraped[scraped.length - 1].gross;
      if (lf.daily) lf.daily = merged;
      log('  ✓ LIVE_FILMS["' + liveKey + '"] updated');
    } else {
      warn('  ✗ No LIVE_FILMS match for "' + fpKey + '"');
    }

    // Update master FILMS array
    var fi = findFilmsIndex(fpKey);
    if (fi !== -1 && fp.india > (FILMS[fi].india || 0)) {
      FILMS[fi].india = fp.india;
      log('  FILMS[' + fi + '] updated');
    }

    // Re-render open film detail page
    var el = document.getElementById('page-film-' + fpKey);
    if (el) {
      try {
        el.parentNode.removeChild(el);
        if (typeof showFilmPageWithPredictions === 'function' && fp.prediction) showFilmPageWithPredictions(fpKey);
        else if (typeof showFilmPage === 'function') showFilmPage(fpKey);
      } catch (e) { warn('Film page re-render failed:', e); }
    }
  }

  // ── 9. Fetch with fallback slug variants ──────────────────────────────────
  function fetchWithFallbacks(item, slugIndex) {
    var slugs = item.config.slugs;
    if (slugIndex >= slugs.length) {
      warn('All slugs failed for "' + item.config.name + '"');
      onAllDone();
      return;
    }

    var slug = slugs[slugIndex];
    var url = 'scraper/output/' + slug + '.json';
    log('Fetching', url);

    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (scraped) {
        if (scraped && scraped.length) {
          log('✓', slug + '.json:', scraped.length, 'days');
          applyScraped(item.fpKey, scraped, item.config);
        }
        onAllDone();
      })
      .catch(function (err) {
        log('✗', slug + '.json:', err.message);
        fetchWithFallbacks(item, slugIndex + 1);
      });
  }

  // ── 10. Kick off ──────────────────────────────────────────────────────────
  keysToFetch.forEach(function (item) { fetchWithFallbacks(item, 0); });
  log('Initiated fetches for', keysToFetch.length, 'film(s)');
})();
