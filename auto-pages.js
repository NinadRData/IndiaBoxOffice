(function () {
  var months = [
    'Jan','Feb','Mar','Apr','May','Jun',
    'Jul','Aug','Sep','Oct','Nov','Dec'
  ];
  var weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var originalShow = window.showFilmPage;

  var aliases = {
    '2026:ramayana': 'ramayanapart1',
    '2026:bhoothbangla': 'bhootbhangla'
  };

  function norm(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function identity(title, year) {
    var name = norm(title);
    var key = year + ':' + name;
    return year + ':' + (aliases[key] || name);
  }

  function similar(first, second) {
    first = norm(first);
    second = norm(second);

    return first.length >= 5 &&
      second.length >= 5 &&
      (first.indexOf(second) === 0 ||
       second.indexOf(first) === 0);
  }

  function el(tag, text, style) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (style) node.style.cssText = style;
    return node;
  }

  function money(value) {
    return Number.isFinite(value)
      ? '₹' + value.toLocaleString('en-IN', {
          maximumFractionDigits: 2
        }) + ' Cr'
      : '—';
  }

   function simplePage(film) {
    var old = document.getElementById('page-film-' + film.key);
    if (old) old.remove();

    var page = el(
      'div',
      null,
      'background:#10171b;color:#fff;min-height:100vh'
    );
    page.id = 'page-film-' + film.key;
    page.className = 'page';

    var hero = el(
      'div',
      null,
      'position:relative;min-height:330px;display:flex;' +
      'align-items:flex-end;background:#24160f center/cover no-repeat;' +
      'overflow:hidden'
    );

    var shade = el(
      'div',
      null,
      'position:absolute;inset:0;' +
      'background:linear-gradient(90deg,rgba(25,10,5,.88),' +
      'rgba(12,10,10,.52)),linear-gradient(0deg,#080a0b,transparent 75%)'
    );
    hero.append(shade);

    var heroInner = el(
      'div',
      null,
      'position:relative;width:100%;max-width:1380px;' +
      'margin:auto;padding:2.2rem 1.5rem'
    );

    var back = el(
      'button',
      '← BACK',
      'padding:.4rem .75rem;border:1px solid rgba(255,255,255,.3);' +
      'border-radius:4px;background:rgba(255,255,255,.06);' +
      'color:#ddd;cursor:pointer;letter-spacing:2px;font-size:.65rem'
    );

    back.onclick = function () {
      showPage('main');
    };

    heroInner.append(back);

    heroInner.append(el(
      'span',
      '  ' + (film.lang || '—').toUpperCase() + '  ·  ' + film.year,
      'color:#f97316;font-size:.72rem;letter-spacing:2px'
    ));

    heroInner.append(el(
      'h1',
      film.title,
      'font-family:"Barlow Condensed",sans-serif;' +
      'font-size:clamp(3rem,7vw,6rem);font-weight:900;' +
      'line-height:.95;margin:1.5rem 0 .8rem'
    ));

    heroInner.append(el(
      'p',
      'Release: ' + (film.release || '—'),
      'color:#b7aaa3;font-size:.9rem'
    ));

    hero.append(heroInner);
    page.append(hero);

    var band = el(
      'div',
      null,
      'background:#090d0e;padding:2rem 1.5rem'
    );

    var stats = el(
      'div',
      null,
      'display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));' +
      'max-width:1380px;margin:auto;border:1px solid #283036;' +
      'border-radius:10px;overflow:hidden'
    );

    var cards = [
      ['India net', money(film.india), 'Domestic theatrical net', '#facc15'],
      ['Worldwide', money(film.ww), 'Global gross', '#facc15'],
      ['Opening weekend', '—', '3-day opening', '#fb923c'],
      ['Multiplier', '—', 'Opening to total', '#4ade80'],
      ['Footfalls', '—', 'Tickets sold', '#38bdf8'],
      ['Budget', '—', 'Production cost', '#a1a1aa'],
      ['Letterboxd', '—', 'Audience rating', '#a1a1aa']
    ];

    cards.forEach(function (item) {
      var card = el(
        'div',
        null,
        'padding:1.2rem;border-right:1px solid #20282d;' +
        'background:#0c1011;min-height:125px'
      );

      card.append(el(
        'div',
        item[0].toUpperCase(),
        'font-size:.58rem;letter-spacing:2px;' +
        'color:#78858b;font-weight:700'
      ));

      card.append(el(
        'div',
        item[1],
        'font-family:"Barlow Condensed",sans-serif;font-size:1.65rem;' +
        'font-weight:800;color:' + item[3] +
        ';margin:.5rem 0;overflow-wrap:anywhere'
      ));

      card.append(el(
        'div',
        item[2],
        'color:#7a858c;font-size:.72rem'
      ));

      stats.append(card);
    });

    band.append(stats);
    page.append(band);

    var content = el(
      'div',
      null,
      'max-width:1280px;margin:auto;padding:2.2rem 1.5rem 3rem'
    );

    var box = el(
      'div',
      null,
      'background:#11191d;border:1px solid #283036;' +
      'border-radius:10px;overflow:hidden'
    );

    var heading = el(
      'div',
      null,
      'padding:1.2rem 1.4rem;border-bottom:1px solid #283036'
    );

    heading.append(el(
      'h2',
      'Daily box office',
      'font-size:1.2rem;margin:0 0 .35rem'
    ));

    heading.append(el(
      'p',
      'India net · ₹ crore',
      'font-size:.72rem;color:#929fa6;margin:0'
    ));

    box.append(heading);

    var max = Math.max.apply(
      null,
      film.daily.map(function (day) {
        return Number(day.gross) || 0;
      })
    ) || 1;

    film.daily.forEach(function (day, index) {
      var row = el(
        'div',
        null,
        'display:flex;align-items:center;gap:1rem;' +
        'padding:.85rem 1.4rem;border-bottom:1px solid #222c31'
      );

      var label = el('div', null, 'width:110px;flex:none');

      label.append(el(
        'div',
        'Day ' + (index + 1),
        'font-weight:700;font-size:.8rem'
      ));

      label.append(el(
        'div',
        day.date,
        'color:#9ba6ac;font-size:.7rem;margin-top:.2rem'
      ));

      row.append(label);

      var track = el(
        'div',
        null,
        'flex:1;height:5px;background:#29343b;' +
        'border-radius:4px;overflow:hidden'
      );

      var width = Math.max(
        0,
        Math.min(100, (Number(day.gross) || 0) / max * 100)
      );

      track.append(el(
        'div',
        null,
        'height:100%;width:' + width + '%;' +
        'background:linear-gradient(90deg,#9a6503,#facc15)'
      ));

      row.append(track);

      var figures = el(
        'div',
        null,
        'text-align:right;white-space:nowrap'
      );

      figures.append(el(
        'div',
        money(day.gross),
        'font-weight:700;color:#facc15'
      ));

      figures.append(el(
        'div',
        'Total ' + money(day.total),
        'font-size:.68rem;color:#9ba6ac;margin-top:.2rem'
      ));

      row.append(figures);
      box.append(row);
    });

    content.append(box);

    var checked = film.fetchedAt
      ? new Date(film.fetchedAt).toLocaleString()
      : 'unknown';

    var note = el(
      'p',
      'Sacnilk estimates · Last checked: ' + checked +
      ' · Missing details are shown as —. ',
      'font-size:.72rem;color:#929fa6;margin:1rem 0'
    );

    var source = el('a', 'View source', 'color:#facc15');
    source.href = film.sourceUrl;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    note.append(source);

    content.append(note);
    page.append(content);

    document.body.append(page);
    showPage('film-' + film.key);

    if (typeof tmdbSearch === 'function') {
      tmdbSearch(film.title, film.year, function (result) {
        if (
          result &&
          result.backdrop &&
          /^https:\/\/image\.tmdb\.org\//.test(result.backdrop) &&
          hero.isConnected
        ) {
          hero.style.backgroundImage =
            'url("' + result.backdrop.replace(/["\\]/g, '') + '")';
        }
      });
    }
  }
  window.showFilmPage = function (key) {
    var page = Object.keys(FILM_PAGES)
      .map(function (item) {
        return FILM_PAGES[item];
      })
      .find(function (film) {
        return film && film.key === key;
      });

    if (!page || !page.autoGenerated) {
      return originalShow.apply(this, arguments);
    }

    // Supply safe defaults while preserving any real details.
    page.cast = Array.isArray(page.cast) ? page.cast : [];
    page.director = page.director || '—';
    page.studio = page.studio || '—';
    page.runtime = page.runtime || '—';
    page.synopsis = page.synopsis || 'Synopsis not available.';

    var release = new Date(page.release + 'T00:00:00Z');

    // For a Friday release, the first three reported days are
    // Friday–Sunday. Don't calculate an opening weekend prematurely.
    if (
      page.ow == null &&
      release.getUTCDay() === 5 &&
      page.daily.length >= 3
    ) {
      page.ow = Math.round(
        page.daily.slice(0, 3).reduce(function (sum, day) {
          return sum + day.gross;
        }, 0) * 100
      ) / 100;
    }

    page.multiplier =
      page.ow > 0 && Number.isFinite(page.india)
        ? Math.round(page.india / page.ow * 100) / 100
        : null;

    page.overseas = Array.isArray(page.overseas)
      ? page.overseas
      : [];

    // Group India net into release-to-Thursday, then Friday–Thursday weeks.
    page.timeline = [];
    var weekTotal = 0;

    page.daily.forEach(function (day, index) {
      weekTotal += day.gross;

      var date = new Date(
        release.getTime() + index * 86400000
      );

      if (
        date.getUTCDay() === 4 ||
        index === page.daily.length - 1
      ) {
        page.timeline.push({
          label:
            'Week ' + (page.timeline.length + 1) +
            (date.getUTCDay() === 4 ? '' : ' (so far)'),
          val: Math.round(weekTotal * 100) / 100
        });

        weekTotal = 0;
      }
    });

    // Use known worldwide figures for the comparison chart.
    page.comparable = FILMS
      .filter(function (film) {
        return film &&
          Number.isFinite(film.ww) &&
          film.ww > 0 &&
          film.n !== page.title;
      })
      .slice()
      .sort(function (a, b) {
        return b.ww - a.ww;
      })
      .slice(0, 5)
      .map(function (film) {
        return {
          n: film.n + ' (' + film.y + ')',
          ww: film.ww
        };
      });

    if (Number.isFinite(page.ww) && page.ww > 0) {
      page.comparable.push({
        n: page.title + ' (' + page.year + ')',
        ww: page.ww,
        highlight: true
      });
    }

    var result = originalShow.apply(this, arguments);
    var root = document.getElementById('page-film-' + key);

    if (root) {
      var body = root.querySelector(
        'div[style*="grid-template-columns:1fr 1fr"]'
      );

      if (body && !(page.budget > 0 && page.ww > 0)) {
        var note = document.createElement('div');
        note.style.cssText =
          'grid-column:1/-1;background:var(--bg3);' +
          'border:1px solid rgba(255,255,255,.07);' +
          'border-radius:6px;padding:1.25rem 1.5rem';

        var heading = document.createElement('strong');
        heading.textContent = 'Profitability';
        note.appendChild(heading);

        var message = document.createElement('p');
        message.textContent =
          'Not available: budget or worldwide gross has not been reported.';
        message.style.color = '#a5afb6';
        note.appendChild(message);

        body.insertBefore(note, body.firstChild);
      }

      var footer = root.querySelector('footer');
      if (footer) {
        footer.textContent =
          'Box Office India · Sacnilk estimates · Last checked: ' +
          (page.fetchedAt
            ? new Date(page.fetchedAt).toLocaleString()
            : 'unknown');
      }
    }

    return result;
  };
  fetch('data/discovered.json', { cache: 'no-cache' })
    .then(function (response) {
      if (!response.ok) throw new Error('Discovery unavailable');
      return response.json();
    })
    .then(function (data) {
      if (
        !Array.isArray(data.films) ||
        !Array.isArray(FILMS) ||
        typeof FILM_PAGES === 'undefined'
      ) return;

      data.films.forEach(function (film) {
        if (
          !film ||
          typeof film.title !== 'string' ||
          /[<>'"`]/.test(film.title) ||
          !Number.isInteger(film.year) ||
          !/^https:\/\/www\.sacnilk\.com\/movie\/[A-Za-z0-9_-]+$/.test(
            film.url
          ) ||
          !Array.isArray(film.days) ||
          !film.days.length ||
          !Number.isFinite(film.indiaNet)
        ) return;

        var days = film.days.slice().sort(function (a, b) {
          return a.day - b.day;
        });

        var release = new Date(film.release + 'T00:00:00Z');
        if (!Number.isFinite(release.getTime())) return;

        var invalid = days.some(function (day, index) {
          var expected = new Date(
            release.getTime() + index * 86400000
          );

          return !day ||
            day.day !== index + 1 ||
            !Number.isFinite(day.indiaNet) ||
            day.indiaNet < 0 ||
            day.date !== expected.toISOString().slice(0, 10);
        });

        if (invalid) return;

        var key = identity(film.title, film.year);

        var existing = FILMS.filter(function (item) {
          return item &&
            item.y === film.year &&
            identity(item.n, item.y) === key;
        });

        if (existing.length > 1) return;

        var possibleDuplicate = FILMS.some(function (item) {
          return item &&
            item.y === film.year &&
            identity(item.n, item.y) !== key &&
            similar(item.n, film.title);
        });

        if (possibleDuplicate) return;

        if (existing.length === 0) {
          FILMS.push({
            n: film.title,
            y: film.year,
            l: film.language || '—',
            india: film.indiaNet,
            ww: film.worldwideGross,
            ow: null,
            actors: [],
            sourceUrl: film.url
          });
        }

        var pages = Object.keys(FILM_PAGES)
          .map(function (item) {
            return FILM_PAGES[item];
          })
          .filter(function (page, index, all) {
            return page &&
              page.year === film.year &&
              identity(page.title, page.year) === key &&
              all.indexOf(page) === index;
          });

        if (pages.length > 1) return;

        if (pages.length === 0) {
          var near = Object.keys(FILM_PAGES).some(function (item) {
            var page = FILM_PAGES[item];
            return page &&
              page.year === film.year &&
              similar(page.title, film.title);
          });

          if (near) return;

          var slug = film.url.split('/').pop()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '-');

          var pageKey = 'auto-' + slug;
          if (FILM_PAGES[pageKey]) return;

          var total = 0;
          var daily = days.map(function (day) {
            var date = new Date(day.date + 'T00:00:00Z');
            total = Math.round((total + day.indiaNet) * 100) / 100;

            return {
              date: date.getUTCDate() + ' ' +
                months[date.getUTCMonth()],
              day: weekdays[date.getUTCDay()],
              gross: day.indiaNet,
              total: total
            };
          });

          FILM_PAGES[pageKey] = {
            key: pageKey,
            title: film.title,
            year: film.year,
            release: film.release,
            lang: film.language || '—',
            india: film.indiaNet,
            ww: film.worldwideGross,
            daily: daily,
            sourceUrl: film.url,
            fetchedAt: film.fetchedAt,
            autoGenerated: true
          };
        } else if (pages[0].autoGenerated) {
          var running = 0;

          pages[0].daily = days.map(function (day) {
            var date = new Date(day.date + 'T00:00:00Z');
            running = Math.round(
              (running + day.indiaNet) * 100
            ) / 100;

            return {
              date: date.getUTCDate() + ' ' +
                months[date.getUTCMonth()],
              day: weekdays[date.getUTCDay()],
              gross: day.indiaNet,
              total: running
            };
          });

          pages[0].india = film.indiaNet;
          pages[0].ww = film.worldwideGross;
          pages[0].fetchedAt = film.fetchedAt;
        }
      });

      if (typeof _lookupPool !== 'undefined') _lookupPool = null;
      if (typeof renderYrTable === 'function') renderYrTable();
      if (typeof renderTG === 'function') renderTG();
      if (typeof renderTraj === 'function') renderTraj();
    })
    .catch(function (error) {
      console.warn('Automatic film discovery unavailable:', error);
    });
})();
