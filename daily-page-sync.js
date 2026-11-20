(function () {
  // Verified source-to-page mapping for Ramayana.
  var mappings = [{
    url: 'https://www.sacnilk.com/movie/ramayana_part_1_2026',
    key: 'ramayana-part-1-2026'
  }];

  var months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  var weekdays = [
    'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'
  ];

  function formatDate(date) {
    return date.getUTCDate() + ' ' + months[date.getUTCMonth()];
  }

  function percentage(value, previous) {
    return previous > 0
      ? Math.round((value / previous - 1) * 1000) / 10
      : null;
  }

  function mergeFilm(source, film) {
    if (
      !film ||
      !/^\d{4}-\d{2}-\d{2}$/.test(film.release) ||
      !Array.isArray(film.daily) ||
      !Array.isArray(source.days)
    ) return false;

    var release = new Date(film.release + 'T00:00:00Z');
    if (!Number.isFinite(release.getTime())) return false;

    var rows = source.days.slice().sort(function (a, b) {
      return a.day - b.day;
    });

    if (!rows.length || rows.length < film.daily.length) return false;

    // Require every day from release to the latest reported day.
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var expected = new Date(
        release.getTime() + i * 86400000
      );

      if (
        !row ||
        row.day !== i + 1 ||
        row.date !== expected.toISOString().slice(0, 10) ||
        !Number.isFinite(row.indiaNet) ||
        row.indiaNet < 0
      ) return false;
    }

    // Keep the page's existing details for days already present.
    var old = {};

    for (var j = 0; j < film.daily.length; j++) {
      var existing = film.daily[j];

      if (
        !existing ||
        existing.bucket ||
        typeof existing.date !== 'string'
      ) return false;

      var match = rows.findIndex(function (row) {
        var date = new Date(row.date + 'T00:00:00Z');
        return formatDate(date) === existing.date.trim();
      });

      if (match < 0 || old[match]) return false;
      old[match] = existing;
    }

    var running = 0;

    var merged = rows.map(function (row, index) {
      var date = new Date(row.date + 'T00:00:00Z');
      running = Math.round((running + row.indiaNet) * 100) / 100;

      return Object.assign({}, old[index] || {}, {
        date: formatDate(date),
        day: weekdays[date.getUTCDay()],
        gross: row.indiaNet,
        total: running,
        chgDay: index
          ? percentage(row.indiaNet, rows[index - 1].indiaNet)
          : null,
        chgWeek: index >= 7
          ? percentage(row.indiaNet, rows[index - 7].indiaNet)
          : null
      });
    });

    film.daily = merged;
    return true;
  }

  fetch('data/tracker.json', { cache: 'no-cache' })
    .then(function (response) {
      if (!response.ok) throw new Error('Daily data unavailable');
      return response.json();
    })
    .then(function (data) {
      if (
        !Array.isArray(data.films) ||
        typeof FILM_PAGES === 'undefined'
      ) return;

      mappings.forEach(function (mapping) {
        var source = data.films.find(function (film) {
          return film.url === mapping.url;
        });

        var film = Object.keys(FILM_PAGES)
          .map(function (key) {
            return FILM_PAGES[key];
          })
          .find(function (page) {
            return page && page.key === mapping.key;
          });

        if (
          !source ||
          !film ||
          source.year !== film.year ||
          !mergeFilm(source, film)
        ) return;

        // Refresh the film page if the visitor already has it open.
        var existing = document.getElementById(
          'page-film-' + film.key
        );
        var active = existing &&
          existing.classList.contains('active');

        if (active) {
          var scroll = window.scrollY;

          if (
            film.prediction &&
            typeof showFilmPageWithPredictions === 'function'
          ) {
            showFilmPageWithPredictions(film.key);
          } else if (typeof showFilmPage === 'function') {
            showFilmPage(film.key);
          }

          window.scrollTo(0, scroll);
        }

        // Refresh the tracking section with the new daily rows.
        if (typeof renderTraj === 'function') {
          renderTraj();
        }

        console.log(
          'Daily India net updated for',
          film.title,
          'through day',
          film.daily.length,
          'from tracker',
          data.updatedAt
        );
      });
    })
    .catch(function (error) {
      console.warn('Daily film data not updated:', error);
    });
})();
