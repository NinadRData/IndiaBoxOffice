/**
 * live-sync.js v3 — Auto-load scraped daily data from GitHub Actions
 */
(function () {
  var DEBUG = true;
  function log() { if (DEBUG && console && console.log) console.log.apply(console, ['[live-sync]'].concat(Array.prototype.slice.call(arguments))); }
  function warn() { if (console && console.warn) console.warn.apply(console, ['[live-sync]'].concat(Array.prototype.slice.call(arguments))); }

  log('v3 initializing...');

  // ── 1. Diagnostic: Check which globals exist ──────────────────────────────
  var hasFILM_PAGES    = typeof FILM_PAGES !== 'undefined';
  var hasLIVE_FILMS    = typeof LIVE_FILMS !== 'undefined';
  var hasFILMS         = typeof FILMS !== 'undefined';
  var hasRenderLive    = typeof renderLiveTracker === 'function';
  var hasRenderYr      = typeof renderYrTable === 'function';
  var hasGetLiveDays   = typeof getLiveDaysInRun === 'function';

  log('Globals:', {
    FILM_PAGES: hasFILM_PAGES,
    LIVE_FILMS: hasLIVE_FILMS,
    FILMS: hasFILMS,
    renderLiveTracker: hasRenderLive,
    renderYrTable: hasRenderYr
  });

  if (hasFILM_PAGES) log('FILM_PAGES keys:', Object.keys(FILM_PAGES));
  if (hasLIVE_FILMS) {
    var liveKeys = Object.keys(LIVE_FILMS);
    log('LIVE_FILMS keys:', liveKeys);
    // Log what's inside each LIVE_FILMS entry so we can match
    liveKeys.forEach(function(k) {
      var lf = LIVE_FILMS[k];
      log('  LIVE_FILMS["' + k + '"]:', {
        title: lf.title || lf.name || '?',
        indiaRunning: lf.indiaRunning,
        yesterdayIndia: lf.yesterdayIndia
      });
    });
  }

  // ── 2. Fix getLiveDaysInRun to use real current date ──────────────────────
  if (hasGetLiveDays) {
    window.getLiveDaysInRun = function (releaseDate) {
      var rel = new Date(releaseDate);
      var now = new Date(); now.setHours(0, 0, 0, 0);
      return Math.max(1, Math.floor((now - rel) / (1000 * 60 * 60 * 24)) + 1);
    };
    log('Patched getLiveDaysInRun to use real date');
  }

  // ── 3. Fuzzy key matcher ──────────────────────────────────────────────────
  // Normalizes a string for comparison: lowercase, strip non-alphanum
  function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // Find a LIVE_FILMS key that matches a FILM_PAGES key
  function findLiveFilmKey(fpKey) {
    if (!hasLIVE_FILMS) return null;
    // Direct match
    if (LIVE_FILMS[fpKey]) return fpKey;
    // Fuzzy match
    var fpNorm = norm(fpKey);
    var liveKeys = Object.keys(LIVE_FILMS);
    for (var i = 0; i < liveKeys.length; i++) {
      var lk = liveKeys[i];
      if (norm(lk) === fpNorm) return lk;
      // Check title inside the entry
      var lf = LIVE_FILMS[lk];
      if (lf.title && norm(lf.title) === fpNorm) return lk;
      if (lf.name && norm(lf.name) === fpNorm) return lk;
      // Partial match
      if (fpNorm.length > 3 && norm(lk).indexOf(fpNorm) !== -1) return lk;
      if (fpNorm.length > 3 && fpNorm.indexOf(norm(lk)) !== -1) return lk;
    }
    return null;
  }

  // Find a FILMS array entry matching a key
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

  // ── 4. Build slug mapping dynamically ─────────────────────────────────────
  // Film name patterns → scraper output filenames to try
  var FILM_PATTERNS = [
    { match: function(k) { return norm(k).indexOf('dhurandhar') !== -1 && norm(k).indexOf('2') !== -1; },
      slugs: ['Dhurandhar2-2026', 'Dhurandhar_2_2026'] },
    { match: function(k) { return norm(k).indexOf('dhurandhar') !== -1; },
      slugs: ['Dhurandhar-2025', 'Dhurandhar_2025'] },
    { match: function(k) { return norm(k).indexOf('bhoot') !== -1 || norm(k).indexOf('bhangla') !== -1; },
      slugs: ['BhootBhangla-2025', 'Bhoot_Bhangla_2025', 'bhoot-bhangla-2025'] },
  ];

  var ALL_SLUGS_TO_TRY = {};
  var fpKeys = hasFILM_PAGES ? Object.keys(FILM_PAGES) : [];

  fpKeys.forEach(function (key) {
    for (var p = 0; p < FILM_PATTERNS.length; p++) {
      if (FILM_PATTERNS[p].match(key)) {
        if (!ALL_SLUGS_TO_TRY[key]) {
          ALL_SLUGS_TO_TRY[key] = FILM_PATTERNS[p].slugs;
        }
        break;
      }
    }
  });

  var keysToFetch = Object.keys(ALL_SLUGS_TO_TRY);
  log('Films to sync:', keysToFetch.length, keysToFetch);

  if (keysToFetch.length === 0) {
    warn('No FILM_PAGES keys matched any known scraper slugs!');
    updateTimestamp();
    if (hasRenderLive) renderLiveTracker();
    return;
  }

  var remaining = keysToFetch.length;

  // ── 5. Callback when all fetches are done ─────────────────────────────────
  function onAllDone() {
    if (--remaining > 0) return;
    log('All fetches complete. Re-rendering...');

    if (hasRenderLive) {
      try { renderLiveTracker(); log('renderLiveTracker() done'); }
      catch (e) { warn('renderLiveTracker() error:', e); }
    }
    if (hasRenderYr) {
      try { renderYrTable(); log('renderYrTable() done'); }
      catch (e) { warn('renderYrTable() error:', e); }
    }
    updateTimestamp();
    log('✅ Sync complete');
  }

  // ── 6. Update "Last updated" text ─────────────────────────────────────────
  function updateTimestamp() {
    var DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
    var d = new Date();
    var text = 'Last updated: ' + DAY_NAMES[d.getDay()] + ', ' +
               d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear() +
               ' · Figures are India nett in ₹ Crore · Click any card to open full film page';

    var metaEl = document.getElementById('live-updated-meta');
    if (metaEl) { metaEl.textContent = text; log('Timestamp updated via #id'); return; }

    var section = document.getElementById('live-tracker-section');
    if (section) {
      var allEls = section.querySelectorAll('*');
      for (var i = 0; i < allEls.length; i++) {
        if (allEls[i].childNodes.length <= 3 && allEls[i].textContent.indexOf('Last updated') !== -1) {
          allEls[i].textContent = text; log('Timestamp updated via text search'); return;
        }
      }
    }
    var allP = document.querySelectorAll('p, div, span');
    for (var j = 0; j < allP.length; j++) {
      if (allP[j].textContent.indexOf('Last updated:') !== -1 && allP[j].textContent.indexOf('India nett') !== -1) {
        allP[j].textContent = text; log('Timestamp updated via global search'); return;
      }
    }
    warn('Could not find "Last updated" element');
  }

  // ── 7. Core merge & apply logic ───────────────────────────────────────────
  function applyScraped(key, scraped) {
    if (!hasFILM_PAGES) return;
    var fp = FILM_PAGES[key];
    if (!fp) { warn('FILM_PAGES["' + key + '"] not found'); return; }

    log('Applying scraped data for "' + key + '":', scraped.length, 'days');

    var hc = (fp.daily || []).filter(function (d) { return !d.bucket && d.gross != null; });
    log('  Hardcoded days:', hc.length, '| Scraped days:', scraped.length);

    // Build merged daily array
    var merged = [];
    var maxLen = Math.max(hc.length, scraped.length);
    var runningTotal = 0;

    for (var i = 0; i < maxLen; i++) {
      var sc = i < scraped.length ? scraped[i] : null;
      var hcRow = i < hc.length ? hc[i] : null;
      var entry;

      if (hcRow && sc) {
        entry = {
          date:    hcRow.date || sc.date || ('Day ' + (i + 1)),
          day:     hcRow.day || '',
          gross:   sc.gross,
          chgDay:  sc.chg_day != null ? sc.chg_day : (hcRow.chgDay != null ? hcRow.chgDay : null),
          chgWeek: hcRow.chgWeek != null ? hcRow.chgWeek : null,
          total:   sc.total
        };
      } else if (sc) {
        entry = {
          date:    sc.date || ('Day ' + (i + 1)),
          day:     '',
          gross:   sc.gross,
          chgDay:  sc.chg_day != null ? sc.chg_day : null,
          chgWeek: null,
          total:   sc.total
        };
      } else if (hcRow) {
        entry = {
          date:    hcRow.date,
          day:     hcRow.day || '',
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

    log('  Merged:', merged.length, 'entries, scraped total:', runningTotal, '| hardcoded india:', fp.india);

    // Replace daily array (this extends the day-by-day breakdown)
    fp.daily = merged;

    // Update India net — use MAX of scraped running total and hardcoded value
    // The hardcoded fp.india may include lifetime adjustments beyond daily tracking
    var newIndia = Math.max(runningTotal, fp.india || 0);
    newIndia = Math.round(newIndia * 100) / 100;
    fp.india = newIndia;
    log('  fp.india set to:', fp.india);

    // Sync prediction actuals
    if (fp.prediction && fp.prediction.actuals) {
      fp.prediction.actuals.running_total = fp.india;
      var w1 = 0;
      for (var j = 0; j < Math.min(7, merged.length); j++) w1 += merged[j].gross;
      fp.prediction.actuals.week1 = Math.round(w1 * 100) / 100;
      log('  Updated prediction actuals');
    }

    // Update LIVE_FILMS — use fuzzy matching to find the right key
    var liveKey = findLiveFilmKey(key);
    if (liveKey) {
      var lf = LIVE_FILMS[liveKey];
      var oldRunning = lf.indiaRunning;
      var oldYesterday = lf.yesterdayIndia;

      // Update running total to match fp.india
      lf.indiaRunning = fp.india;

      // Update yesterday's figure from the last scraped day
      if (scraped.length > 0) {
        lf.yesterdayIndia = scraped[scraped.length - 1].gross;
      }

      // If LIVE_FILMS has its own daily array, update that too
      if (lf.daily) {
        lf.daily = merged;
      }

      log('  ✓ LIVE_FILMS["' + liveKey + '"] updated:',
          'indiaRunning', oldRunning, '→', lf.indiaRunning,
          '| yesterdayIndia', oldYesterday, '→', lf.yesterdayIndia);
    } else {
      warn('  ✗ No matching LIVE_FILMS key found for "' + key + '"');
      if (hasLIVE_FILMS) warn('    Available LIVE_FILMS keys:', Object.keys(LIVE_FILMS));
    }

    // Update master FILMS array
    var fi = findFilmsIndex(key);
    if (fi !== -1) {
      var oldFilmsIndia = FILMS[fi].india;
      if (fp.india > (FILMS[fi].india || 0)) {
        FILMS[fi].india = fp.india;
      }
      log('  FILMS[' + fi + '] (' + FILMS[fi].title + ') india:', oldFilmsIndia, '→', FILMS[fi].india);
    } else {
      log('  No matching FILMS entry found for "' + key + '"');
    }

    // Re-render the film detail page if it is currently open
    var el = document.getElementById('page-film-' + key);
    if (el) {
      try {
        el.parentNode.removeChild(el);
        if (typeof showFilmPageWithPredictions === 'function' && fp.prediction) {
          showFilmPageWithPredictions(key);
        } else if (typeof showFilmPage === 'function') {
          showFilmPage(key);
        }
        log('  Re-rendered open film page for', key);
      } catch (e) { warn('  Film page re-render failed:', e); }
    }
  }

  // ── 8. Fetch with fallback slug variants ──────────────────────────────────
  function fetchWithFallbacks(key, slugVariants, index) {
    if (index >= slugVariants.length) {
      warn('All slug variants failed for "' + key + '" — no scraped data available');
      onAllDone();
      return;
    }

    var slug = slugVariants[index];
    var url = 'scraper/output/' + slug + '.json';
    log('Fetching', url);

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (scraped) {
        if (scraped && scraped.length) {
          log('✓ Loaded', slug + '.json:', scraped.length, 'days');
          applyScraped(key, scraped);
        } else {
          log('Empty data from', slug + '.json');
        }
        onAllDone();
      })
      .catch(function (err) {
        log('✗', slug + '.json:', err.message, '— trying next...');
        fetchWithFallbacks(key, slugVariants, index + 1);
      });
  }

  // ── 9. Kick off fetches ───────────────────────────────────────────────────
  keysToFetch.forEach(function (key) {
    fetchWithFallbacks(key, ALL_SLUGS_TO_TRY[key], 0);
  });

  log('Initiated fetches for', keysToFetch.length, 'film(s)');
})();
