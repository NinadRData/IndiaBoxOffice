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
  var hasFILM_PAGES  = typeof FILM_PAGES !== 'undefined' && FILM_PAGES !== null;
  var hasLIVE_FILMS  = typeof LIVE_FILMS !== 'undefined' && LIVE_FILMS !== null;
  var hasFILMS       = typeof FILMS !== 'undefined' && FILMS !== null && Array.isArray(FILMS);
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
      try {
        var rel = new Date(releaseDate);
        if (isNaN(rel.getTime())) return 1;
        var now = new Date(); 
        now.setHours(0, 0, 0, 0);
        var days = Math.max(1, Math.floor((now - rel) / (1000 * 60 * 60 * 24)) + 1);
        return days;
      } catch (e) {
        warn('getLiveDaysInRun error:', e);
        return 1;
      }
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
  // dayIndex 0 = Day 0 (preview, day before release)
  // dayIndex 1 = Day 1 (theatrical release)
  // e.g. releaseDate='2026-03-19', dayIndex=0 → {date:'Wed Mar 18', day:'Wed'}
  //      releaseDate='2026-03-19', dayIndex=1 → {date:'Thu Mar 19', day:'Thu'}
  function computeDateLabel(releaseDate, dayIndex) {
    try {
      var rel = new Date(releaseDate + 'T00:00:00Z');
      if (isNaN(rel.getTime())) {
        rel = new Date(releaseDate);
      }
      // dayIndex 0 = 1 day before release, 1 = release day, 2 = day after, etc.
      var d = new Date(rel.getTime() + (dayIndex - 1) * 86400000);
      var dayNum = d.getDay();
      var monthNum = d.getMonth();
      
      if (dayNum < 0 || dayNum >= DAY_SHORT.length) dayNum = 0;
      if (monthNum < 0 || monthNum >= MON_SHORT.length) monthNum = 0;
      
      var dayName = DAY_SHORT[dayNum];
      var monName = MON_SHORT[monthNum];
      var dateNum = d.getDate();
      return { date: dayName + ' ' + monName + ' ' + dateNum, day: dayName };
    } catch (e) {
      warn('computeDateLabel error:', e);
      return { date: 'Day ' + dayIndex, day: 'Day' };
    }
  }

  // ── 4. Fuzzy key matcher ──────────────────────────────────────────────────
  function norm(s) { 
    if (!s) return '';
    return (s + '').toLowerCase().replace(/[^a-z0-9]/g, ''); 
  }

  function findLiveFilmKey(fpKey) {
    if (!hasLIVE_FILMS) return null;
    if (LIVE_FILMS[fpKey]) return fpKey;
    
    var fpNorm = norm(fpKey);
    if (!fpNorm) return null;
    
    var liveKeys = Object.keys(LIVE_FILMS);
    for (var i = 0; i < liveKeys.length; i++) {
      var lk = liveKeys[i];
      var lf = LIVE_FILMS[lk];
      if (!lf) continue;
      
      if (norm(lk) === fpNorm) return lk;
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
    if (!keyNorm) return -1;
    
    for (var i = 0; i < FILMS.length; i++) {
      var f = FILMS[i];
      if (!f) continue;
      if (norm(f.title) === keyNorm) return i;
      if (f.id && norm(f.id) === keyNorm) return i;
      if (f.key && norm(f.key) === keyNorm) return i;
      var slug = (f.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (slug === key) return i;
    }
    return -1;
  }

  // ── 5. Film config with release dates & slug variants ─────────────────────
  // releaseDate: YYYY-MM-DD (first day after preview; Day 0 is 1 day before)
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
    releaseDate: '2026-04-17',
    slugs: ['BhoothBangla-2026', 'Bhooth_Bangla_2026', 'BhootBhangla-2026', 'Bhoot_Bhangla_2026',
            'BhoothBangla-2025', 'Bhooth_Bangla_2025', 'BhootBhangla-2025', 'Bhoot_Bhangla_2025'],
    match: function(k) {
      var n = norm(k);
      return n.indexOf('bhoot') !== -1 || n.indexOf('bhangla') !== -1 || n.indexOf('bangla') !== -1;
    }
  },
  {
    name: 'Karuppu',
    releaseDate: '2026-05-15',
    slugs: ['Karuppu-2026', 'Karuppu_2026'],
    match: function(k) {
      var n = norm(k);
      return n.indexOf('karuppu') !== -1;
    }
  },
  {
    name: 'Peddi',
    releaseDate: '2026-06-03',
    slugs: ['Peddi-2026', 'Peddi_2026'],
    match: function(k) {
      var n = norm(k);
      return n.indexOf('peddi') !== -1;
    }
  }
];
  

  // Find matching FILM_PAGES keys for each config entry
  var keysToFetch = []; // {fpKey, config}
  var fpKeys = hasFILM_PAGES ? Object.keys(FILM_PAGES) : [];

  FILM_CONFIG.forEach(function (cfg) {
    if (!cfg) return;
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
    if (hasRenderLive) {
      try { renderLiveTracker(); } catch(e) { warn('renderLiveTracker error:', e); }
    }
    return;
  }

  var remaining = keysToFetch.length;

  // ── 6. Callback when all fetches are done ─────────────────────────────────
  function onAllDone() {
    if (--remaining > 0) return;
    log('All fetches complete. Re-rendering...');
    if (hasRenderLive) { 
      try { renderLiveTracker(); } catch(e) { warn('renderLiveTracker error:', e); } 
    }
    if (hasRenderYr) { 
      try { renderYrTable(); } catch(e) { warn('renderYrTable error:', e); } 
    }
    updateTimestamp();
    log('✅ Sync complete');
  }

  // ── 7. Update "Last updated" text ─────────────────────────────────────────
  function updateTimestamp() {
    try {
      var d = new Date();
      var dayIdx = d.getDay();
      var monthIdx = d.getMonth();
      
      if (dayIdx < 0 || dayIdx >= DAY_LONG.length) dayIdx = 0;
      if (monthIdx < 0 || monthIdx >= MON_LONG.length) monthIdx = 0;
      
      var text = 'Last updated: ' + DAY_LONG[dayIdx] + ', ' +
                 d.getDate() + ' ' + MON_LONG[monthIdx] + ' ' + d.getFullYear() +
                 ' · Figures are India nett in ₹ Crore · Click any card to open full film page';

      var metaEl = document.getElementById('live-updated-meta');
      if (metaEl) { metaEl.textContent = text; return; }

      var section = document.getElementById('live-tracker-section');
      if (section) {
        var allEls = section.querySelectorAll('*');
        for (var i = 0; i < allEls.length; i++) {
          var el = allEls[i];
          if (el.childNodes.length <= 3 && el.textContent && el.textContent.indexOf('Last updated') !== -1) {
            el.textContent = text; return;
          }
        }
      }
      var allP = document.querySelectorAll('p, div, span');
      for (var j = 0; j < allP.length; j++) {
        var pEl = allP[j];
        var pText = pEl.textContent || '';
        if (pText.indexOf('Last updated:') !== -1 && pText.indexOf('India nett') !== -1) {
          pEl.textContent = text; return;
        }
      }
    } catch (e) {
      warn('updateTimestamp error:', e);
    }
  }

 // ── 8. Core merge & apply logic ───────────────────────────────────────────
function applyScraped(fpKey, scraped, config) {
  if (!hasFILM_PAGES) return;
  if (!Array.isArray(scraped)) return;
  
  var fp = FILM_PAGES[fpKey];
  if (!fp || typeof fp !== 'object') return;

  log('Applying "' + config.name + '" → FILM_PAGES["' + fpKey + '"]:', scraped.length, 'scraped days');

  var hc = [];
  if (fp.daily && Array.isArray(fp.daily)) {
    hc = fp.daily.filter(function (d) { return d && !d.bucket && d.gross != null; });
  }

  var merged = [];
  var maxLen = Math.max(hc.length, scraped.length);
  var runningTotal = 0;

  for (var i = 0; i < maxLen; i++) {
    var sc = i < scraped.length ? scraped[i] : null;
    var hcRow = i < hc.length ? hc[i] : null;
    var entry = null;

    // FIX: Look for an explicit day index from the scraper, otherwise fallback to index mapping
    // If your scraper puts Day 0 at index 0, then dayIndex should be i.
    // If index 0 is Day 1, dayIndex should be i + 1.
    var dayIndex = (sc && sc.dayNum !== undefined) ? sc.dayNum : i; 

    // Compute real calendar date using the verified day position
    var realDate = computeDateLabel(config.releaseDate, dayIndex);

    if (hcRow && sc) {
      var hcDate = hcRow.date || '';
      var useHcDate = hcDate && hcDate.indexOf('Day ') !== 0;
      entry = {
        date:    useHcDate ? hcDate : realDate.date,
        day:     useHcDate ? (hcRow.day || realDate.day) : realDate.day,
        gross:   sc.gross != null ? sc.gross : null,
        chgDay:  sc.chg_day != null ? sc.chg_day : (hcRow.chgDay != null ? hcRow.chgDay : null),
        chgWeek: hcRow.chgWeek != null ? hcRow.chgWeek : null,
        total:   sc.total != null ? sc.total : null
      };
    } else if (sc) {
      entry = {
        date:    realDate.date,
        day:     realDate.day,
        gross:   sc.gross != null ? sc.gross : null,
        chgDay:  sc.chg_day != null ? sc.chg_day : null,
        chgWeek: null,
        total:   sc.total != null ? sc.total : null
      };
    } else if (hcRow) {
      entry = {
        date:    hcRow.date || realDate.date,
        day:     hcRow.day || realDate.day,
        gross:   hcRow.gross != null ? hcRow.gross : null,
        chgDay:  hcRow.chgDay != null ? hcRow.chgDay : null,
        chgWeek: hcRow.chgWeek != null ? hcRow.chgWeek : null,
        total:   hcRow.total != null ? hcRow.total : null
      };
    }

    if (entry) {
      if (entry.total != null) {
        runningTotal = entry.total;
      }
      merged.push(entry);
    }
  }

  // ... (Rest of your existing applyScraped logic remains exactly the same)

    log('  Merged:', merged.length, 'entries, running total:', runningTotal);

    // Show a sample of the new date labels
    if (merged.length > hc.length) {
      var sampleEnd = Math.min(hc.length + 3, merged.length);
      var sample = merged.slice(hc.length, sampleEnd).map(function(e) { return e ? e.date : '?'; });
      log('  New date labels (first 3 beyond hardcoded):', sample);
    }

// Replace daily array
fp.daily = merged;

// Update India net — use the last total from merged array
var lastEntry = merged.length > 0 ? merged[merged.length - 1] : null;
var mergedTotal = lastEntry && lastEntry.total != null ? lastEntry.total : runningTotal;
var newIndia = Math.max(mergedTotal || 0, fp.india || 0);
fp.india = Math.round(newIndia * 100) / 100;
log('  fp.india:', fp.india);

    // Sync prediction actuals
    if (fp.prediction && typeof fp.prediction === 'object' && fp.prediction.actuals && typeof fp.prediction.actuals === 'object') {
      fp.prediction.actuals.running_total = fp.india;
      var w1 = 0;
      var week1Days = Math.min(7, merged.length);
      for (var j = 0; j < week1Days; j++) {
        var day = merged[j];
        if (day && day.gross != null) {
          w1 += day.gross;
        }
      }
      fp.prediction.actuals.week1 = Math.round(w1 * 100) / 100;
    }

    // Update LIVE_FILMS (fuzzy match)
    var liveKey = findLiveFilmKey(fpKey);
    if (liveKey) {
      var lf = LIVE_FILMS[liveKey];
      if (lf && typeof lf === 'object') {
        lf.indiaRunning = fp.india;
        if (scraped.length > 0) {
          var lastScraped = scraped[scraped.length - 1];
          if (lastScraped && lastScraped.gross != null) {
            lf.yesterdayIndia = lastScraped.gross;
          }
        }
        if (lf.daily) lf.daily = merged;
        log('  ✓ LIVE_FILMS["' + liveKey + '"] updated');
      }
    } else {
      warn('  ✗ No LIVE_FILMS match for "' + fpKey + '"');
    }

    // Update master FILMS array
    var fi = findFilmsIndex(fpKey);
    if (fi !== -1 && hasFILMS && FILMS[fi]) {
      if (fp.india > (FILMS[fi].india || 0)) {
        FILMS[fi].india = fp.india;
        log('  FILMS[' + fi + '] updated');
      }
    }

    // Re-render open film detail page
    var el = document.getElementById('page-film-' + fpKey);
    if (el && el.parentNode) {
      try {
        el.parentNode.removeChild(el);
        if (typeof showFilmPageWithPredictions === 'function' && fp.prediction) {
          showFilmPageWithPredictions(fpKey);
        } else if (typeof showFilmPage === 'function') {
          showFilmPage(fpKey);
        }
      } catch (e) { warn('Film page re-render failed:', e); }
    }
  }

  // ── 9. Fetch with fallback slug variants ──────────────────────────────────
  function fetchWithFallbacks(item, slugIndex) {
    if (!item || !item.config || !item.config.slugs) {
      onAllDone();
      return;
    }
    
    var slugs = item.config.slugs;
    if (slugIndex >= slugs.length) {
      warn('All slugs failed for "' + item.config.name + '"');
      onAllDone();
      return;
    }

    var slug = slugs[slugIndex];
    if (!slug) {
      fetchWithFallbacks(item, slugIndex + 1);
      return;
    }
    
    var url = 'scraper/output/' + slug + '.json';
    log('Fetching', url);

    fetch(url)
      .then(function (r) { 
        if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : 'unknown')); 
        return r.json(); 
      })
      .then(function (scraped) {
        if (scraped && Array.isArray(scraped) && scraped.length > 0) {
          log('✓', slug + '.json:', scraped.length, 'days');
          applyScraped(item.fpKey, scraped, item.config);
        }
        onAllDone();
      })
      .catch(function (err) {
        log('✗', slug + '.json:', err ? err.message : 'unknown error');
        fetchWithFallbacks(item, slugIndex + 1);
      });
  }

  // ── 10. Kick off ──────────────────────────────────────────────────────────
  keysToFetch.forEach(function (item) { 
    if (item) fetchWithFallbacks(item, 0); 
  });
  log('Initiated fetches for', keysToFetch.length, 'film(s)');
})();
