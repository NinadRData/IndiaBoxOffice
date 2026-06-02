/**
 * live-sync.js v2 — Auto-load scraped daily data from GitHub Actions
 *
 * Fetches scraper/output/*.json and merges into the page's data structures
 * so the website always shows up-to-date box office figures.
 *
 * USAGE: <script src="live-sync.js"></script> right before </body>
 */
(function () {
  var DEBUG = true; // Set to false to silence console output
  function log() { if (DEBUG && console && console.log) console.log.apply(console, ['[live-sync]'].concat(Array.prototype.slice.call(arguments))); }
  function warn() { if (console && console.warn) console.warn.apply(console, ['[live-sync]'].concat(Array.prototype.slice.call(arguments))); }

  log('v2 initializing...');

  // ── 1. Diagnostic: Check which globals exist ──────────────────────────────
  var hasFILM_PAGES    = typeof FILM_PAGES !== 'undefined';
  var hasLIVE_FILMS    = typeof LIVE_FILMS !== 'undefined';
  var hasFILMS         = typeof FILMS !== 'undefined';
  var hasRenderLive    = typeof renderLiveTracker === 'function';
  var hasRenderYr      = typeof renderYrTable === 'function';
  var hasGetLiveDays   = typeof getLiveDaysInRun === 'function';

  log('Globals detected:', {
    FILM_PAGES: hasFILM_PAGES,
    LIVE_FILMS: hasLIVE_FILMS,
    FILMS: hasFILMS,
    renderLiveTracker: hasRenderLive,
    renderYrTable: hasRenderYr,
    getLiveDaysInRun: hasGetLiveDays
  });

  if (hasFILM_PAGES) {
    log('FILM_PAGES keys:', Object.keys(FILM_PAGES));
  }
  if (hasLIVE_FILMS) {
    log('LIVE_FILMS keys:', Object.keys(LIVE_FILMS));
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

  // ── 3. Build slug mapping dynamically ─────────────────────────────────────
  // Maps FILM_PAGES key → scraper output filename (without .json)
  // We try multiple approaches to find the right mapping:

  // Known mappings (update when adding new films to scraper/films.json)
  var KNOWN_SLUGS = {
    'bhoot-bhangla':  ['BhootBhangla-2025', 'Bhoot_Bhangla_2025'],
    'dhurandhar':     ['Dhurandhar-2025', 'Dhurandhar_2025'],
    'dhurandhar-2':   ['Dhurandhar2-2026', 'Dhurandhar_2_2026']
  };

  // Available scraper output files (we'll try all known variants)
  var ALL_SLUGS_TO_TRY = {};
  var fpKeys = hasFILM_PAGES ? Object.keys(FILM_PAGES) : [];

  // Match FILM_PAGES keys to known slugs
  fpKeys.forEach(function (key) {
    if (KNOWN_SLUGS[key]) {
      ALL_SLUGS_TO_TRY[key] = KNOWN_SLUGS[key];
    }
  });

  // Also try matching by partial name for any FILM_PAGES key containing these film names
  fpKeys.forEach(function (key) {
    if (ALL_SLUGS_TO_TRY[key]) return; // already matched
    var lower = key.toLowerCase();
    if (lower.indexOf('dhurandhar') !== -1 && lower.indexOf('2') !== -1) {
      ALL_SLUGS_TO_TRY[key] = ['Dhurandhar2-2026', 'Dhurandhar_2_2026'];
    } else if (lower.indexOf('dhurandhar') !== -1) {
      ALL_SLUGS_TO_TRY[key] = ['Dhurandhar-2025', 'Dhurandhar_2025'];
    } else if (lower.indexOf('bhoot') !== -1) {
      ALL_SLUGS_TO_TRY[key] = ['BhootBhangla-2025', 'Bhoot_Bhangla_2025'];
    }
  });

  var keysToFetch = Object.keys(ALL_SLUGS_TO_TRY);
  log('Films to sync:', keysToFetch.length, keysToFetch);

  if (keysToFetch.length === 0) {
    warn('No FILM_PAGES keys matched any known scraper slugs!');
    warn('If your FILM_PAGES uses different keys, add them to KNOWN_SLUGS in live-sync.js');
    // Still update timestamp even with nothing to sync
    updateTimestamp();
    if (hasRenderLive) renderLiveTracker();
    return;
  }

  var remaining = keysToFetch.length;

  // ── 4. Callback when all fetches are done ─────────────────────────────────
  function onAllDone() {
    if (--remaining > 0) return;
    log('All fetches complete. Re-rendering...');

    if (hasRenderLive) {
      try { renderLiveTracker(); log('renderLiveTracker() called'); }
      catch (e) { warn('renderLiveTracker() failed:', e); }
    }
    if (hasRenderYr) {
      try { renderYrTable(); log('renderYrTable() called'); }
      catch (e) { warn('renderYrTable() failed:', e); }
    }
    updateTimestamp();
  }

  // ── 5. Update "Last updated" text ─────────────────────────────────────────
  function updateTimestamp() {
    var DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
    var d = new Date();
    var text = 'Last updated: ' + DAY_NAMES[d.getDay()] + ', ' +
               d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear() +
               ' · Figures are India nett in ₹ Crore · Click any card to open full film page';

    // Method 1: by ID
    var metaEl = document.getElementById('live-updated-meta');
    if (metaEl) {
      metaEl.textContent = text;
      log('Timestamp updated via #live-updated-meta');
      return;
    }

    // Method 2: search inside #live-tracker-section
    var section = document.getElementById('live-tracker-section');
    if (section) {
      var allEls = section.querySelectorAll('*');
      for (var i = 0; i < allEls.length; i++) {
        if (allEls[i].childNodes.length <= 3 &&
            allEls[i].textContent.indexOf('Last updated') !== -1) {
          allEls[i].textContent = text;
          log('Timestamp updated via text search in #live-tracker-section');
          return;
        }
      }
    }

    // Method 3: search entire document
    var allP = document.querySelectorAll('p, div, span');
    for (var j = 0; j < allP.length; j++) {
      if (allP[j].textContent.indexOf('Last updated:') !== -1 &&
          allP[j].textContent.indexOf('India nett') !== -1) {
        allP[j].textContent = text;
        log('Timestamp updated via global text search');
        return;
      }
    }

    warn('Could not find "Last updated" element to update');
  }

  // ── 6. Core merge & apply logic ───────────────────────────────────────────
  function applyScraped(key, scraped) {
    if (!hasFILM_PAGES) { warn('FILM_PAGES not found, skipping merge for', key); return; }
    var fp = FILM_PAGES[key];
    if (!fp) { warn('FILM_PAGES["' + key + '"] not found, skipping'); return; }

    log('Applying scraped data for "' + key + '":', scraped.length, 'days');

    // Hardcoded actual days: exclude bucket placeholders and null-gross entries
    var hc = (fp.daily || []).filter(function (d) { return !d.bucket && d.gross != null; });
    log('  Hardcoded days:', hc.length, '| Scraped days:', scraped.length);

    // Build merged daily array — ALWAYS merge if scraped has data
    // (removed the old scraped.length <= hc.length guard)
    var merged = [];
    var maxLen = Math.max(hc.length, scraped.length);
    var runningTotal = 0;

    for (var i = 0; i < maxLen; i++) {
      var sc = i < scraped.length ? scraped[i] : null;
      var hcRow = i < hc.length ? hc[i] : null;
      var entry;

      if (hcRow && sc) {
        // Both exist: use hardcoded labels + scraped financial data
        entry = {
          date:    hcRow.date || sc.date || ('Day ' + (i + 1)),
          day:     hcRow.day || '',
          gross:   sc.gross,
          chgDay:  sc.chg_day != null ? sc.chg_day : (hcRow.chgDay != null ? hcRow.chgDay : null),
          chgWeek: hcRow.chgWeek != null ? hcRow.chgWeek : null,
          total:   sc.total
        };
      } else if (sc) {
        // Only scraped (new day beyond hardcoded range)
        entry = {
          date:    sc.date || ('Day ' + (i + 1)),
          day:     '',
          gross:   sc.gross,
          chgDay:  sc.chg_day != null ? sc.chg_day : null,
          chgWeek: null,
          total:   sc.total
        };
      } else if (hcRow) {
        // Only hardcoded (scraper has fewer days — keep hardcoded)
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

    log('  Merged daily array:', merged.length, 'entries, running total:', runningTotal);

    // Replace daily array
    fp.daily = merged;

    // Update India net total (always use the higher value)
    var oldIndia = fp.india;
    if (runningTotal > (fp.india || 0)) {
      fp.india = Math.round(runningTotal * 100) / 100;
    }
    log('  India net: was', oldIndia, '→ now', fp.india);

    // Sync prediction actuals if present
    if (fp.prediction && fp.prediction.actuals) {
      fp.prediction.actuals.running_total = fp.india;
      var w1 = 0;
      for (var j = 0; j < Math.min(7, merged.length); j++) w1 += merged[j].gross;
      fp.prediction.actuals.week1 = Math.round(w1 * 100) / 100;
      log('  Updated prediction actuals');
    }

    // Update LIVE_FILMS entry
    if (hasLIVE_FILMS && LIVE_FILMS[key]) {
      LIVE_FILMS[key].indiaRunning = fp.india;
      if (merged.length > 0) {
        LIVE_FILMS[key].yesterdayIndia = merged[merged.length - 1].gross;
      }
      log('  Updated LIVE_FILMS["' + key + '"]');
    }

    // Update master FILMS array
    if (hasFILMS) {
      for (var fi = 0; fi < FILMS.length; fi++) {
        var filmTitle = FILMS[fi].title || '';
        var filmSlug = filmTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        if (filmSlug === key || FILMS[fi].id === key || FILMS[fi].key === key) {
          if (fp.india > (FILMS[fi].india || 0)) {
            FILMS[fi].india = fp.india;
            log('  Updated FILMS[' + fi + '] (' + filmTitle + ') india to', fp.india);
          }
          break;
        }
      }
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
      } catch (e) {
        warn('  Failed to re-render film page:', e);
      }
    }
  }

  // ── 7. Fetch with fallback slug variants ──────────────────────────────────
  function fetchWithFallbacks(key, slugVariants, index) {
    if (index >= slugVariants.length) {
      log('All slug variants failed for "' + key + '"');
      onAllDone();
      return;
    }

    var slug = slugVariants[index];
    var url = 'scraper/output/' + slug + '.json';
    log('Fetching', url, '...');

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
        log('✗', slug + '.json failed:', err.message, '— trying next variant...');
        fetchWithFallbacks(key, slugVariants, index + 1);
      });
  }

  // ── 8. Kick off fetches ───────────────────────────────────────────────────
  keysToFetch.forEach(function (key) {
    fetchWithFallbacks(key, ALL_SLUGS_TO_TRY[key], 0);
  });

  log('Initiated fetches for', keysToFetch.length, 'film(s)');
})();
