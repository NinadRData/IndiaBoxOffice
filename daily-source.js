(function () {
  'use strict';

  // Every view uses the same pair of fetches and timeout outcome.
  var pending = null;

  function load(path) {
    return Promise.race([
      fetch(path, { cache: 'no-cache' })
        .then(function (response) {
          if (!response.ok) throw new Error(path);
          return response.json();
        })
        .catch(function () {
          return null;
        }),

      new Promise(function (resolve) {
        setTimeout(function () {
          resolve(null);
        }, 10000);
      })
    ]);
  }

  window.loadDailyFeeds = function () {
    if (!pending) {
      pending = Promise.all([
        load('data/tracker.json'),
        load('data/discovered.json')
      ]);
    }

    return pending;
  };

  // Shared choice for the weekly chart, daily chart and generated pages.
  window.resolveDailyFeeds = function (tracker, discovery) {
    var groups = Object.create(null);

    function add(documentData, source) {
      if (!documentData || !Array.isArray(documentData.films)) {
        return;
      }

      documentData.films.forEach(function (film) {
        if (
          !film ||
          typeof film.title !== 'string' ||
          !Number.isInteger(film.year) ||
          !/^https:\/\/www\.sacnilk\.com\/movie\/[A-Za-z0-9_-]+$/.test(
            film.url || ''
          ) ||
          !Array.isArray(film.days)
        ) {
          return;
        }

        var group = groups[film.url];

        if (!group) {
          group = groups[film.url] = {};
        }

        // Don't silently choose between duplicates in one feed.
        if (group[source]) {
          group.ambiguous = true;
          return;
        }

        var rawStamp = source === 'tracker'
          ? documentData.updatedAt
          : (film.fetchedAt || documentData.updatedAt);

        group[source] = {
          film: film,
          stamp: Date.parse(rawStamp || ''),
          source: source
        };
      });
    }

    add(tracker, 'tracker');
    add(discovery, 'discovery');

    return Object.keys(groups)
      .map(function (url) {
        var group = groups[url];
        var tracked = group.tracker;
        var found = group.discovery;

        if (group.ambiguous) return null;
        if (!tracked) return found || null;
        if (!found) return tracked;

        // The same URL with conflicting years needs investigation.
        if (tracked.film.year !== found.film.year) return null;

        // Generated pages require consecutive days from release.
        // Use newer tracker rows only if they meet that rule and
        // are at least as complete as the discovery history.
        var release = new Date(
          found.film.release + 'T00:00:00Z'
        );

        var days = tracked.film.days.slice().sort(function (a, b) {
          return (a && a.day || 0) - (b && b.day || 0);
        });

        var valid = Number.isFinite(release.getTime()) &&
          days.length >= found.film.days.length &&
          days.every(function (day, index) {
            var expected = new Date(
              release.getTime() + index * 86400000
            );

            return day &&
              day.day === index + 1 &&
              Number.isFinite(day.indiaNet) &&
              day.indiaNet >= 0 &&
              day.date === expected.toISOString().slice(0, 10);
          });

        if (
          Number.isFinite(tracked.stamp) &&
          Number.isFinite(found.stamp) &&
          tracked.stamp > found.stamp &&
          valid
        ) {
          return tracked;
        }

        return found;
      })
      .filter(Boolean);
  };
})();
