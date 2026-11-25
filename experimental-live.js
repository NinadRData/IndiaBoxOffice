(function () {
  'use strict';

  var aliases = {
    '2026:ramayana': 'ramayanapart1',
    '2026:dhurandhar2therevenge': 'dhurandhar2',
    '2026:drishyam3theconclusion': 'drishyamtheconclusion',
    '2026:bhoothbangla': 'bhootbhangla',
    '2025:kantaraalegendchapter1': 'kantarachapter1',
    '2025:mahavatarnarsimha': 'mahavtarnarsimha'
  };

  function id(title, year) {
    var name = String(title || '')
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');

    return year + ':' + (aliases[year + ':' + name] || name);
  }

  function safe(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[character];
    });
  }

  function fetchJson(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error(path);
      return response.json();
    });
  }

  function validRows(film) {
    if (!film || !Array.isArray(film.days)) return null;

    var days = film.days.slice().sort(function (a, b) {
      return a.day - b.day;
    });

    if (days.length < 7) return null;

    var first = Date.parse(days[0].date + 'T00:00:00Z');

    if (!Number.isFinite(first)) return null;

    for (var i = 0; i < days.length; i++) {
      var day = days[i];

      if (
        !day ||
        day.day !== i + 1 ||
        !Number.isFinite(day.indiaNet) ||
        day.indiaNet < 0 ||
        day.date !== new Date(
          first + i * 86400000
        ).toISOString().slice(0, 10)
      ) {
        return null;
      }
    }

    return days;
  }

  function median(values) {
    var sorted = values.slice().sort(function (a, b) {
      return a - b;
    });

    var middle = Math.floor(sorted.length / 2);

    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function sum(days) {
    return days.reduce(function (total, day) {
      return total + day.indiaNet;
    }, 0);
  }

  function money(value) {
    return '₹' + value.toLocaleString('en-IN', {
      maximumFractionDigits: 2
    }) + ' Cr';
  }

  var paths = [
    'data/tracker.json',
    'data/discovered.json',
    'data/historical.json',
    'data/historical_totals.json',
    'data/sacnilk.json'
  ];

  Promise.all(paths.map(fetchJson))
    .then(function (documents) {
      if (typeof FILM_PAGES === 'undefined') return;

      var pages = [];
      var languages = {};

      function refreshPages() {
        pages = Object.keys(FILM_PAGES)
          .map(function (key) {
            return FILM_PAGES[key];
          })
          .filter(function (page, index, all) {
            return page &&
              page.key &&
              page.title &&
              all.indexOf(page) === index;
          });

        languages = {};

        pages.forEach(function (page) {
          var key = id(page.title, page.year);
          var language = String(page.lang || '').toLowerCase();

          if (
            !/^(hindi|tamil|telugu|malayalam|kannada)$/.test(language)
          ) {
            return;
          }

          if (!languages[key]) languages[key] = new Set();
          languages[key].add(language);
        });
      }

      var byUrl = {};

      (documents[0].films || [])
        .concat(documents[1].films || [])
        .forEach(function (film) {
          if (!film || !film.url) return;

          var previous = byUrl[film.url];
          var timestamp = Date.parse(film.fetchedAt || '') || 0;

          if (!previous || timestamp > previous.timestamp) {
            byUrl[film.url] = {
              film: film,
              timestamp: timestamp
            };
          }
        });

      var targets = Object.keys(byUrl).map(function (url) {
        return byUrl[url].film;
      });

      var totals = {};

      (documents[3].films || [])
        .concat(documents[4].films || [])
        .forEach(function (film) {
          if (
            !film ||
            !film.url ||
            !Number.isFinite(film.indiaNet) ||
            film.indiaNet <= 0
          ) {
            return;
          }

          var key = film.url + '|' + film.year;

          if (!totals[key]) totals[key] = [];
          totals[key].push(film.indiaNet);
        });

      var industries = {};

      (documents[3].films || [])
        .concat(documents[3].industryFilms || [])
        .forEach(function (film) {
          if (film && film.industry === 'Malayalam') {
            industries[film.url + '|' + film.year] = 'malayalam';
          }
        });

      function languageFor(film) {
        var values = new Set(languages[id(film.title, film.year)] || []);
        var reported = String(film.language || '').toLowerCase();

        if (
          /^(hindi|tamil|telugu|malayalam|kannada)$/.test(reported)
        ) {
          values.add(reported);
        }

        var industry = industries[film.url + '|' + film.year];

        if (industry) values.add(industry);

        return values.size === 1 ? Array.from(values)[0] : null;
      }

      function targetFor(page) {
        var explicit = page.sacnilkUrl || page.sourceUrl;

        var matches = targets.filter(function (film) {
          return film.year === page.year && (
            explicit
              ? film.url === explicit
              : id(film.title, film.year) === id(page.title, page.year)
          );
        });

        if (matches.length !== 1) return null;

        if (
          !explicit &&
          pages.filter(function (other) {
            return other.year === page.year &&
              id(other.title, other.year) === id(page.title, page.year);
          }).length !== 1
        ) {
          return null;
        }

        return matches[0];
      }

      function forecast(page) {
        var film = targetFor(page);
        var days = validRows(film);

        if (!days) return null;

        var lastDate = days[days.length - 1].date;
        var asOf = Date.parse(lastDate + 'T00:00:00Z');

        var today = Date.parse(
          new Date().toISOString().slice(0, 10) + 'T00:00:00Z'
        );

        // Only show the forecast for recently reported films.
        if (
          today - asOf > 14 * 86400000 ||
          asOf - today > 86400000
        ) {
          return null;
        }

        var language = languageFor(film);
        var firstWeek = sum(days.slice(0, 7));
        var banked = sum(days);

        if (!language || firstWeek <= 0 || days[0].indiaNet <= 0) {
          return null;
        }

        var hold = days[6].indiaNet / days[0].indiaNet;
        var peers = [];

        (documents[2].films || []).forEach(function (other) {
          if (
            !other ||
            other.url === film.url ||
            other.year < 2021 ||
            languageFor(other) !== language ||
            !Array.isArray(other.days)
          ) {
            return;
          }

          var sorted = other.days.slice().sort(function (a, b) {
            return a.day - b.day;
          });

          // Require comparable daily data through the same release day.
          var throughDay = validRows({
            days: sorted.slice(0, days.length)
          });

          if (
            !throughDay ||
            throughDay.length !== days.length ||
            throughDay[0].indiaNet <= 0
          ) {
            return;
          }

          var firstSeven = throughDay.slice(0, 7);
          var comparableTotal = sum(throughDay);
          var comparableWeek = sum(firstSeven);

          var comparableHold =
            firstSeven[6].indiaNet / firstSeven[0].indiaNet;

          var last = sorted[sorted.length - 1];
          var comparableLastDate = Date.parse(
            (last && last.date) + 'T00:00:00Z'
          );

          var reference = totals[other.url + '|' + other.year];

          if (
            !Number.isFinite(comparableLastDate) ||
            comparableLastDate + 30 * 86400000 > asOf ||
            !reference ||
            reference.length !== 1 ||
            comparableWeek <= 0 ||
            comparableTotal <= 0 ||
            comparableHold <= 0 ||
            reference[0] < comparableTotal ||
            hold <= 0
          ) {
            return;
          }

          var estimate = Math.max(
            banked,
            banked * reference[0] / comparableTotal
          );

          var distance =
            Math.abs(Math.log(comparableWeek / firstWeek)) +
            Math.abs(Math.log(comparableHold / hold));

          peers.push({
            title: other.title,
            year: other.year,
            estimate: estimate,
            distance: distance
          });
        });

        peers.sort(function (a, b) {
          return a.distance - b.distance;
        });

        peers = peers.slice(0, 3);

        if (peers.length < 3) return null;

        var estimates = peers.map(function (peer) {
          return peer.estimate;
        });

        return {
          day: days.length,
          date: lastDate,
          banked: banked,
          low: Math.min.apply(null, estimates),
          middle: median(estimates),
          high: Math.max.apply(null, estimates),
          peers: peers
        };
      }

      function render() {
        refreshPages();

        pages.forEach(function (page) {
          var node = document.getElementById('page-film-' + page.key);

          if (
            !node ||
            node.querySelector('[data-experimental-live-forecast]')
          ) {
            return;
          }

                    var result = forecast(page);

          if (!result) {
            var source = targetFor(page);

            if (
              !source ||
              !Array.isArray(source.days) ||
              !source.days.length
            ) {
              return;
            }

            var lastDay = source.days.slice().sort(function (a, b) {
              return a.day - b.day;
            }).pop();

            var lastTime = Date.parse(
              (lastDay && lastDay.date) + 'T00:00:00Z'
            );

            var today = Date.parse(
              new Date().toISOString().slice(0, 10) + 'T00:00:00Z'
            );

            if (
              !Number.isFinite(lastTime) ||
              today - lastTime > 14 * 86400000 ||
              lastTime - today > 86400000
            ) {
              return;
            }

            var notice = document.createElement('section');

            notice.setAttribute(
              'data-experimental-live-forecast',
              ''
            );

            notice.style.cssText =
              'margin:24px auto;padding:20px;max-width:960px;' +
              'border:1px solid #414850;border-radius:12px;' +
              'background:#151c21;color:#c7cdd1;font-family:inherit';

            notice.textContent = source.days.length < 7
              ? 'Experimental live forecast: waiting for at least ' +
                'seven complete days of India-net data.'
              : 'Experimental live forecast unavailable: complete ' +
                'daily data, a confirmed language and three suitable ' +
                'earlier films are required.';

            node.appendChild(notice);
            return;
          }

          var box = document.createElement('section');
          box.setAttribute('data-experimental-live-forecast', '');

          box.style.cssText =
            'margin:24px auto;padding:22px;max-width:960px;' +
            'border:1px solid #414850;border-radius:12px;' +
            'background:#151c21;color:#f2f4f6;font-family:inherit';

          var cards = [
            ['Low', result.low],
            ['Middle', result.middle],
            ['High', result.high]
          ].map(function (item) {
            return (
              '<div style="flex:1;min-width:140px;background:#202a30;' +
                'border-radius:8px;padding:14px">' +
                '<span style="color:#aab2b8;font-size:.75rem">' +
                  item[0] +
                '</span><br>' +
                '<strong style="font-size:1.2rem;color:#f5c518">' +
                  money(item[1]) +
                '</strong>' +
              '</div>'
            );
          }).join('');

          var comparisons = result.peers.map(function (peer) {
            return safe(peer.title) + ' (' + peer.year + ')';
          }).join(', ');

          box.innerHTML =
            '<div style="display:flex;gap:12px;align-items:center;' +
              'flex-wrap:wrap">' +
              '<strong style="font-size:1.15rem">' +
                'Experimental live forecast' +
              '</strong>' +
              '<span style="font-size:.75rem;color:#aaa">' +
                'India net · estimates, not probabilities' +
              '</span>' +
            '</div>' +

            '<p style="color:#aaa;font-size:.85rem">' +
              'Based on reports through ' + safe(result.date) +
              ' (day ' + result.day + '); reported daily sum ' +
              money(result.banked) + '.' +
            '</p>' +

            '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
              cards +
            '</div>' +

            '<p style="font-size:.85rem;color:#c7cdd1">' +
              'Comparisons: ' + comparisons + '.' +
            '</p>' +

            '<p style="font-size:.75rem;color:#9aa4aa">' +
              'Uses three older same-language films, matched by first-week ' +
              'size and day-seven hold; projected using their reported ' +
              'totals through the same day. Source totals may have been ' +
              'revised. Holidays, releases and changing conditions are ' +
              'not modelled.' +
            '</p>';

          node.appendChild(box);
        });
      }

      render();

      var timer;

      new MutationObserver(function () {
        clearTimeout(timer);
        timer = setTimeout(render, 100);
      }).observe(document.body, {
        childList: true,
        subtree: true
      });
    })
    .catch(function (error) {
      console.warn('Experimental forecast unavailable:', error);
    });
})();
