/**
 * live-sync.js — Auto-load scraped daily data from GitHub Actions
 *
 * This script fetches the JSON files committed by the daily scrape workflow
 * (scraper/output/*.json) and merges them into the page's hardcoded data
 * so the website always shows up-to-date box office figures.
 *
 * USAGE: Add this line to your index.html, right before </body>:
 *   <script src="live-sync.js"></script>
 *
 * HOW IT WORKS:
 * 1. Overrides getLiveDaysInRun() to use the real current date (not hardcoded)
 * 2. Fetches scraper/output/{slug}.json for each tracked film
 * 3. Merges scraped data with hardcoded FILM_PAGES daily arrays
 * 4. Updates LIVE_FILMS, FILMS master array, and prediction actuals
 * 5. Re-renders the live tracker, yearly table, and any open film detail page
 * 6. Updates the "Last updated" timestamp to today's date
 *
 * Falls back silently to hardcoded data if any fetch fails.
 */

(function () {
  'use strict';

  // ── 1. Fix getLiveDaysInRun to use real current date ──────────────────────
  // The hardcoded version freezes at a fixed date. This override ensures
  // the day counter advances naturally every day.
  if (typeof window.getLiveDaysInRun === 'function') {
    window.getLiveDaysInRun = function (releaseDate) {
      var rel = new Date(releaseDate);
      var now = new Date(); now.setHours(0, 0, 0, 0);
      return Math.max(1, Math.floor((now - rel) / (1000 * 60 * 60 * 24)) + 1);
    };
  }

  // ── 2. Slug mapping ──────────────────────────────────────────────────────
  // Keys = FILM_PAGES keys used in index.html
  // Values = filenames in scraper/output/ (from films.json slug field)
  // UPDATE THIS MAP when you add new films to scraper/films.json
  var SCRAPER_SLUGS = {
    'bhoot-bhangla':  'BhootBhangla-2025',
    'dhurandhar':     'Dhurandhar-2025',
    'dhurandhar-2':   'Dhurandhar2-2026'
  };

  var keys = Object.keys(SCRAPER_SLUGS);
  var remaining = keys.length;

  // ── 3. Callback when all fetches are done ─────────────────────────────────
  function onAllDone() {
    if (--remaining > 0) return;

    // Re-render live tracker with corrected date logic
    if (typeof renderLiveTracker === 'function') renderLiveTracker();

    // Re-render yearly table with updated totals
    if (typeof renderYrTable === 'function') renderYrTable();

    // Update the "Last updated" timestamp
    updateTimestamp();
  }

  // ── 4. Update "Last updated" text ─────────────────────────────────────────
  function updateTimestamp() {
    var DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
    var d = new Date();
    var text = 'Last updated: ' + DAY_NAMES[d.getDay()] + ', ' +
               d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear() +
               ' · Figures are India nett in ₹ Crore · Click any card to open full film page';

    // Try by ID first (if user added id="live-updated-meta")
    var metaEl = document.getElementById('live-updated-meta');
    if (metaEl) {
      metaEl.textContent = text;
      return;
    }

    // Fallback: find the element by its existing text content
    var candidates = document.querySelectorAll('#live-tracker-section p, #live-tracker-section div, #live-tracker-section span');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].textContent.indexOf('Last updated:') !== -1) {
        candidates[i].textContent = text;
        return;
      }
    }
  }

  // ── 5. Core merge logic ───────────────────────────────────────────────────
  // Merges scraped rows with hardcoded daily data.
  // Strategy:
  //   - Only replace data if scraper has MORE days than hardcoded
  //   - Preserve rich date/day-of-week labels from hardcoded rows
  //   - Append Day-N labels for newly scraped days
  //   - Use scraped gross/total values (may have been corrected by sacnilk)
  function applyScraped(key, scraped) {
    if (typeof FILM_PAGES === 'undefined') return;
    var fp = FILM_PAGES[key];
    if (!fp) return;

    // Hardcoded actual days: exclude bucket placeholders and null-gross entries
    var hc = (fp.daily || []).filter(function (d) { return !d.bucket && d.gross != null; });

    // Only update if the scraper has more days than what is already hardcoded
    if (scraped.length <= hc.length) return;

    // Build merged daily array
    var merged = [];
    var runningTotal = 0;

    for (var i = 0; i < scraped.length; i++) {
      var sc = scraped[i];
      var entry;

      if (i < hc.length) {
        // Preserve hardcoded labels, use scraped financial data
        entry = {
          date:    hc[i].date || sc.date || ('Day ' + (i + 1)),
          day:     hc[i].day  || '',
          gross:   sc.gross,
          chgDay:  sc.chg_day != null ? sc.chg_day : (hc[i].chgDay || null),
          chgWeek: hc[i].chgWeek || null,
          total:   sc.total
        };
      } else {
        // New day beyond hardcoded range — use scraped labels
        entry = {
          date:    sc.date || ('Day ' + (i + 1)),
          day:     '',
          gross:   sc.gross,
          chgDay:  sc.chg_day != null ? sc.chg_day : null,
          chgWeek: null,
          total:   sc.total
        };
      }

      runningTotal = entry.total;
      merged.push(entry);
    }

    // Replace daily array
    fp.daily = merged;

    // Update India net total
    if (runningTotal > fp.india) fp.india = Math.round(runningTotal * 100) / 100;

    // Sync prediction actuals if present
    if (fp.prediction && fp.prediction.actuals) {
      fp.prediction.actuals.running_total = fp.india;
      var w1 = 0;
      for (var j = 0; j < Math.min(7, merged.length); j++) w1 += merged[j].gross;
      fp.prediction.actuals.week1 = Math.round(w1 * 100) / 100;
    }

    // Update LIVE_FILMS entry
    if (typeof LIVE_FILMS !== 'undefined' && LIVE_FILMS[key]) {
      LIVE_FILMS[key].indiaRunning = fp.india;
      if (merged.length > 0) {
        LIVE_FILMS[key].yesterdayIndia = merged[merged.length - 1].gross;
      }
    }

    // Update master FILMS array
    if (typeof FILMS !== 'undefined') {
      for (var fi = 0; fi < FILMS.length; fi++) {
        var slug = (FILMS[fi].title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        if (slug === key || FILMS[fi].id === key) {
          if (fp.india > (FILMS[fi].india || 0)) FILMS[fi].india = fp.india;
          break;
        }
      }
    }

    // Re-render the film detail page if it is currently open
    var el = document.getElementById('page-film-' + key);
    if (el) {
      el.parentNode.removeChild(el);
      if (typeof showFilmPageWithPredictions === 'function' && fp.prediction) {
        showFilmPageWithPredictions(key);
      } else if (typeof showFilmPage === 'function') {
        showFilmPage(key);
      }
    }
  }

  // ── 6. Fetch and apply scraped data for each tracked film ─────────────────
  keys.forEach(function (key) {
    var slug = SCRAPER_SLUGS[key];
    fetch('scraper/output/' + slug + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (scraped) {
        if (scraped && scraped.length) applyScraped(key, scraped);
        onAllDone();
      })
      .catch(function (err) {
        // Silent fail — hardcoded data remains untouched
        console.log('[live-sync] Could not load ' + slug + '.json:', err.message || err);
        onAllDone();
      });
  });

  console.log('[live-sync] Auto-loading scraped data for ' + keys.length + ' film(s)...');
})();
