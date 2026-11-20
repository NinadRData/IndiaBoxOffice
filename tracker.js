(function () {
  var chart = document.getElementById('weekly-chart');
  var live = document.getElementById('live-tracker-section');
  if (!chart || !live) return;

  var weekly = chart.parentElement.parentElement;

  function el(tag, text, css) {
    var node = document.createElement(tag);
    if (text !== null) node.textContent = text;
    if (css) node.style.cssText = css;
    return node;
  }

  function rupees(value) {
    return Number.isFinite(value)
      ? '₹' + value.toLocaleString('en-IN', {
          maximumFractionDigits: 2
        }) + ' Cr'
      : '—';
  }

  function dateText(date) {
    return new Date(date + 'T12:00:00Z').toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }

  function header(container, title, detail) {
    container.replaceChildren();
    container.append(el(
      'h2',
      title,
      'font-size:1rem;letter-spacing:.15em;' +
      'text-transform:uppercase;margin-bottom:.5rem'
    ));
    container.append(el(
      'p',
      detail,
      'font-size:.75rem;color:#a0a8ae;margin-bottom:1rem'
    ));
  }

  function utcDate(value) {
    return new Date(value + 'T00:00:00Z');
  }

  function addDays(date, number) {
    return new Date(date.getTime() + number * 86400000);
  }

  function iso(date) {
    return date.toISOString().slice(0, 10);
  }

  header(weekly, 'This week at the box office', 'Loading daily collections…');
  header(live, 'Live tracker', 'Loading daily collections…');

  fetch('data/tracker.json', { cache: 'no-cache' })
    .then(function (response) {
      if (!response.ok) throw new Error('Tracker data unavailable');
      return response.json();
    })
    .then(function (data) {
      if (
        !Array.isArray(data.films) ||
        !data.films.length ||
        !Number.isFinite(Date.parse(data.updatedAt))
      ) {
        throw new Error('Invalid tracker data');
      }

      var asOf = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date(data.updatedAt));

      var today = utcDate(asOf);
      if (!Number.isFinite(today.getTime())) {
        throw new Error('Invalid update date');
      }

      // The chart week runs Friday through Thursday.
      var start = addDays(today, -((today.getUTCDay() + 2) % 7));
      var end = addDays(start, 6);
      var since = iso(start);
      var until = iso(end);

      var stale = Date.now() - Date.parse(data.updatedAt) >
        48 * 3600000;
      var updated = new Date(data.updatedAt).toLocaleString();

      header(
        weekly,
        'This week at the box office',
        'India net · ' + dateText(since) + ' – ' + dateText(until) +
        ' · Results through the last available day; partial estimates' +
        ' · Refreshed ' + updated +
        (stale ? ' · May be out of date' : '')
      );

      header(
        live,
        'Live tracker',
        'Source-reported running films · Refreshed ' + updated +
        (stale ? ' · May be out of date' : '')
      );

      var rows = [];

      data.films.forEach(function (film) {
        if (
          typeof film.title !== 'string' ||
          !/^https:\/\/www\.sacnilk\.com\/movie\/[A-Za-z0-9_-]+$/.test(
            film.url
          ) ||
          !Array.isArray(film.days)
        ) return;

        var days = film.days.filter(function (day) {
          return /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
            Number.isFinite(day.indiaNet);
        }).sort(function (a, b) {
          return a.date.localeCompare(b.date);
        });

        if (!days.length) return;

        var last = days[days.length - 1];

        var week = days.filter(function (day) {
          return day.date >= since &&
            day.date <= until &&
            day.date <= asOf;
        });

        if (week.length) {
          rows.push({
            film: film,
            week: week,
            total: week.reduce(function (sum, day) {
              return sum + day.indiaNet;
            }, 0)
          });
        }

        var card = el(
          'a',
          null,
          'display:block;background:rgba(255,255,255,.04);' +
          'border:1px solid rgba(255,255,255,.08);' +
          'border-radius:8px;padding:1rem;color:inherit;' +
          'text-decoration:none;margin:.6rem 0'
        );

        card.href = film.url;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';

        card.append(el('strong', film.title, 'font-size:1.05rem'));

        card.append(el(
          'p',
          'India net: ' + rupees(film.indiaNet) +
          ' · Worldwide: ' + rupees(film.worldwideGross),
          'margin:.5rem 0;color:#fbbf24'
        ));

        card.append(el(
          'p',
          'Latest reported: ' + dateText(last.date) +
          ' · Day ' + last.day +
          ' · ' + rupees(last.indiaNet) + ' India net',
          'font-size:.8rem;color:#b0b8bd'
        ));

        live.append(card);
      });

      rows.sort(function (a, b) {
        return b.total - a.total;
      });

      if (!rows.length) {
        weekly.append(el(
          'p',
          'No daily collections reported for this week yet.',
          'color:#aaa'
        ));
      }

      rows.forEach(function (row, index) {
        var last = row.week[row.week.length - 1];

        var line = el(
          'div',
          null,
          'display:flex;justify-content:space-between;gap:1rem;' +
          'padding:.8rem;border-bottom:1px solid rgba(255,255,255,.08)'
        );

        line.append(el('span', (index + 1) + '. ' + row.film.title));

        line.append(el(
          'span',
          rupees(row.total) + ' · through ' + dateText(last.date),
          'text-align:right;color:#fbbf24'
        ));

        weekly.append(line);
      });
    })
    .catch(function () {
      header(
        weekly,
        'This week at the box office',
        'Daily data is unavailable.'
      );
      header(live, 'Live tracker', 'Daily data is unavailable.');
    });
})();
