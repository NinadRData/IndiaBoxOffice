(function () {
  'use strict';

  var data = null;

  var aliases = {
    '2026:ramayana':'ramayanapart1',
    '2026:bhoothbangla':'bhootbhangla',
    '2026:dhurandhar2therevenge':'dhurandhar2',
    '2026:drishyam3theconclusion':'drishyamtheconclusion',
    '2025:kantaraalegendchapter1':'kantarachapter1',
    '2025:mahavatarnarsimha':'mahavtarnarsimha'
  };

  function identity(title, year) {
    var name = String(title || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');

    var key = String(year) + ':' + name;

    return String(year) + ':' + (aliases[key] || name);
  }

  function sync() {
    if (
      !data ||
      !Array.isArray(data.films) ||
      typeof FILM_PAGES === 'undefined'
    ) return;

    var pages = Object.keys(FILM_PAGES)
      .map(function (key) {
        return FILM_PAGES[key];
      })
      .filter(function (page, index, all) {
        return page &&
          page.key &&
          page.title &&
          all.indexOf(page) === index;
      });

    var records = data.films.filter(function (film) {
      return (
        film &&
        typeof film.title === 'string' &&
        Number.isInteger(film.year) &&
        Array.isArray(film.points) &&
        /^https:\/\/www\.sacnilk\.com\/movie\/[A-Za-z0-9_-]+$/.test(
          film.url || ''
        )
      );
    });

    var counts = Object.create(null);

    records.forEach(function (film) {
      var key = identity(film.title, film.year);
      counts[key] = (counts[key] || 0) + 1;
    });

    var changed = 0;

    records.forEach(function (film) {
      var key = identity(film.title, film.year);

      if (counts[key] !== 1) return;

      var matches = pages.filter(function (page) {
        if (page.year !== film.year) return false;

        var url = page.sacnilkUrl || page.sourceUrl;

        return url
          ? url === film.url
          : identity(page.title, page.year) === key;
      });

      if (matches.length !== 1) return;

      var page = matches[0];

      var old = Array.isArray(page.wwCum)
        ? page.wwCum.slice()
        : [];

      var manual = Object.create(null);

      old.forEach(function (point, index) {
        if (
          point &&
          typeof point === 'object' &&
          point.source === 'sacnilk-report'
        ) return;

        var day = typeof point === 'number'
          ? index + 1
          : Number(
              point &&
              (point.d != null ? point.d : point.day)
            );

        var raw = typeof point === 'number'
          ? point
          : (
              point &&
              (
                point.v != null
                  ? point.v
                  : (
                      point.total != null
                        ? point.total
                        : point.gross
                    )
              )
            );

        if (
          Number.isInteger(day) &&
          day > 0 &&
          raw != null &&
          Number.isFinite(Number(raw)) &&
          Number(raw) >= 0
        ) {
          manual[day] = true;
        }
      });

            // Keep existing reports if the latest file omits them.
      // A manual point takes priority over an automatic point
      // for the same day.
      //
      // Null placeholders preserve the day positions of older
      // manually entered numeric values.
      var merged = old.slice();

      merged.forEach(function (point, index) {
        if (
          !point ||
          typeof point !== 'object' ||
          point.source !== 'sacnilk-report'
        ) {
          return;
        }

        var day = Number(
          point.d != null ? point.d : point.day
        );

        if (manual[day]) {
          merged[index] = null;
        }
      });

      var seen = Object.create(null);

      film.points.forEach(function (point) {
        if (
          !point ||
          !Number.isInteger(point.day) ||
          point.day < 1 ||
          !Number.isFinite(point.worldwideGross) ||
          point.worldwideGross < 0 ||
          manual[point.day] ||
          seen[point.day]
        ) return;

        if (
          typeof point.reportUrl !== 'string' ||
          !/^https:\/\/www\.sacnilk\.com\/quicknews\/[A-Za-z0-9_-]+$/.test(
            point.reportUrl
          )
        ) return;

        seen[point.day] = true;

                var replacement = {
          d: point.day,
          v: point.worldwideGross,
          source: 'sacnilk-report',
          reportUrl: point.reportUrl
        };

        var replaced = false;

        merged.forEach(function (oldPoint, index) {
          if (
            !oldPoint ||
            typeof oldPoint !== 'object' ||
            oldPoint.source !== 'sacnilk-report'
          ) {
            return;
          }

          var oldDay = Number(
            oldPoint.d != null ? oldPoint.d : oldPoint.day
          );

          if (oldDay !== point.day) return;

          // Replace the first old automatic point and clear duplicates.
          merged[index] = replaced ? null : replacement;
          replaced = true;
        });

        if (!replaced) {
          merged.push(replacement);
        }
      });

      if (JSON.stringify(merged) !== JSON.stringify(old)) {
        page.wwCum = merged;
        changed++;
      }
    });

    if (changed && typeof renderTraj === 'function') {
      renderTraj();
    }
  }

  document.addEventListener(
    'opening-weekend-data-ready',
    sync
  );

  fetch('data/worldwide.json', {cache:'no-cache'})
    .then(function (response) {
      if (!response.ok) {
        throw new Error('Worldwide data unavailable');
      }

      return response.json();
    })
    .then(function (result) {
      data = result;
      sync();
    })
    .catch(function (error) {
      console.warn('Worldwide day data unavailable:', error);
    });
})();
