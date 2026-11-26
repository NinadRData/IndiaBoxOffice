(function () {
  'use strict';

  function key(title, year) {
    return String(year) + ':' + String(title || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
      return false;
    }

    var date = new Date(value + 'T00:00:00Z');

    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }

  function todayIndia() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());

    var values = {};

    parts.forEach(function (part) {
      values[part.type] = part.value;
    });

    return values.year + '-' + values.month + '-' + values.day;
  }

  fetch('data/historical.json', { cache: 'no-cache' })
    .then(function (response) {
      if (!response.ok) {
        throw new Error('Historical feed unavailable');
      }

      return response.json();
    })
    .then(function (history) {
      if (
        !history ||
        history.kind !== 'historical' ||
        !Array.isArray(history.films) ||
        typeof predictorEligibleFilm !== 'function' ||
        typeof FILMS === 'undefined' ||
        !Array.isArray(FILMS)
      ) {
        return;
      }

      var byKey = Object.create(null);

      history.films.forEach(function (film) {
        if (
          !film ||
          typeof film.title !== 'string' ||
          !film.title.trim() ||
          !Number.isInteger(film.year) ||
          !validDate(film.release) ||
          Number(film.release.slice(0, 4)) !== film.year ||
          !/^https:\/\/www\.sacnilk\.com\/movie\/[A-Za-z0-9_-]+$/.test(
            film.url || ''
          ) ||
          !Array.isArray(film.days)
        ) {
          return;
        }

        var first = film.days.filter(function (row) {
          return row && row.day === 1;
        });

        if (
          first.length !== 1 ||
          first[0].date !== film.release
        ) {
          return;
        }

        var id = key(film.title, film.year);

        if (!byKey[id]) byKey[id] = [];
        byKey[id].push(film.release);
      });

      var counts = Object.create(null);

      FILMS.forEach(function (film) {
        if (
          !film ||
          !film.n ||
          !Number.isInteger(Number(film.y))
        ) {
          return;
        }

        var id = key(film.n, Number(film.y));

        counts[id] = (counts[id] || 0) + 1;
      });

      var original = predictorEligibleFilm;

      window.predictorEligibleFilm = function (film, targetDate) {
        if (!film || !validDate(targetDate)) return false;

        var id = key(film.n, Number(film.y));
        var dates = byKey[id];

        // Keep the existing behavior when there is no usable
        // historical match.
        if (!dates) {
          return original(film, targetDate);
        }

        // Avoid choosing between duplicate or ambiguous records.
        if (dates.length !== 1 || counts[id] !== 1) {
          return false;
        }

        var today = todayIndia();
        var cutoff = targetDate < today ? targetDate : today;

        var releaseTime = Date.parse(
          dates[0] + 'T00:00:00Z'
        );

        var cutoffTime = Date.parse(
          cutoff + 'T00:00:00Z'
        );

        // Require at least three calendar days after release.
        return releaseTime + 3 * 86400000 <= cutoffTime;
      };

      if (typeof renderPreds === 'function') {
        renderPreds();
      }

      console.info(
        'Forecast chronology: using matching historical ' +
        'release dates where available.'
      );
    })
    .catch(function (error) {
      console.warn('Forecast chronology unavailable:', error);
    });
})();
