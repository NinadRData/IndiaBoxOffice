/* TMDB upcoming Indian theatrical releases; keeps manual UPCOMING entries. */
(function () {
  if (!Array.isArray(window.UPCOMING) || typeof TMDB_KEY === 'undefined') return;
  var names = {hi:'Hindi', ta:'Tamil', te:'Telugu', ml:'Malayalam', kn:'Kannada'};
  var base = 'https://api.themoviedb.org/3/';
  var norm = function (s) { return String(s || '').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,''); };
  var today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
  var end = new Date(today + 'T00:00:00Z');
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  var endDate = end.toISOString().slice(0,10);
  function get(path, params) {
    params.api_key = TMDB_KEY;
    return fetch(base + path + '?' + new URLSearchParams(params)).then(function (r) {
      if (!r.ok) throw new Error('TMDB HTTP ' + r.status);
      return r.json();
    });
  }
  // Avoid a forecast based solely on a shared language for newly discovered films.
  var originalPrediction = window.getUpcomingAutoPrediction;
  if (typeof originalPrediction === 'function') {
    window.getUpcomingAutoPrediction = function (film) {
      if (film.tmdbAuto) {
        var actor = norm(film.actor), director = norm(film.director);
        var peers = FILMS.filter(function (f) {
                   return f && Number(f.y) >= 2021 &&
            predictorEligibleFilm(f, film.date) &&
            Number.isFinite(Number(f.ow)) && Number(f.ow) > 0 &&
            ((actor && Array.isArray(f.actors) && f.actors.some(function(a){return norm(a) === actor;})) ||
             (director && norm(f.director) === director));
        });
        if (peers.length < 3) return null;
      }
      return originalPrediction(film);
    };
  }
  var requests = Object.keys(names).map(function (lang) {
    return get('discover/movie', {region:'IN', with_release_type:'2|3',
      'release_date.gte':today, 'release_date.lte':endDate,
      with_original_language:lang, sort_by:'popularity.desc', page:1});
  });
  Promise.all(requests).then(function (lists) {
    var seenIds = {};
    var candidates = [];
    lists.forEach(function (list) { (list.results || []).forEach(function (m) {
      if (m && m.id && names[m.original_language] && !seenIds[m.id]) {
        seenIds[m.id] = true; candidates.push(m);
      }
    }); });
    // Details supply India-specific theatrical dates and credits. Limit concurrent requests.
    var results = [], index = 0;
    function worker() {
      if (index >= candidates.length) return Promise.resolve();
      var item = candidates[index++];
      return get('movie/' + item.id, {append_to_response:'release_dates,credits'}).then(function (d) {
        var india = ((d.release_dates || {}).results || []).find(function (x) { return x.iso_3166_1 === 'IN'; });
        var dates = india ? india.release_dates.filter(function (x) { return (x.type === 2 || x.type === 3) && x.release_date; }).map(function (x) { return x.release_date.slice(0,10); }).filter(function (x) {return /^\d{4}-\d{2}-\d{2}$/.test(x);}).sort() : [];
        // Earliest Indian theatrical release must still be in the future.
        var date = dates[0];
        if (!date || date < today || date > endDate) return;
        var credits = d.credits || {}, cast = credits.cast || [], crew = credits.crew || [];
        var director = crew.find(function (p) { return p.job === 'Director'; });
        results.push({n:d.title || item.title, y:Number(date.slice(0,4)), l:names[item.original_language], date:date,
          actor:cast.length ? cast[0].name : '', director:director ? director.name : '',
          note:'TMDB · Indian theatrical release · date subject to change', tmdbAuto:true, tmdbId:item.id});
      }).catch(function () { /* skip a film if its details cannot be checked */ }).then(worker);
    }
    return Promise.all(Array.from({length:6}, worker)).then(function () { return results; });
  }).then(function (films) {
    var existing = {};
    UPCOMING.forEach(function (f) { existing[norm(f.n)] = true; });
    films.sort(function (a,b) {return a.date.localeCompare(b.date);}).forEach(function (film) {
      var key = norm(film.n);
      if (!key || existing[key]) return;
      existing[key] = true; UPCOMING.push(film);
    });
    if (typeof renderPreds === 'function') renderPreds();
    console.info('[upcoming] TMDB discovery complete:', films.length, 'verified upcoming entries');
  }).catch(function (err) { console.warn('[upcoming] TMDB discovery unavailable:', err); });
})();

