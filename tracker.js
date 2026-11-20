(function () {
  var chart = document.getElementById('weekly-chart');
  var live = document.getElementById('live-tracker-section');
  if (!chart || !live) return;

  var weekly = chart.parentElement.parentElement;

  function el(tag, text, css) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (css) node.style.cssText = css;
    return node;
  }

  function money(number) {
    return Number.isFinite(number)
      ? '₹' + number.toLocaleString('en-IN', {
          maximumFractionDigits: 2
        }) + ' Cr'
      : '—';
  }

  function date(value) {
    return new Date(value + 'T12:00:00Z');
  }

  function showDate(value) {
    return date(value).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }

  function iso(value) {
    return value.toISOString().slice(0, 10);
  }

  function add(value, days) {
    return new Date(value.getTime() + days * 86400000);
  }

  function reset(box, title, detail) {
    box.replaceChildren();

    box.append(el(
      'h2',
      title,
      'font-size:1rem;letter-spacing:.14em;' +
      'text-transform:uppercase;margin:0 0 .5rem'
    ));

    box.append(el(
      'p',
      detail,
      'font-size:.76rem;color:#a5afb6;' +
      'margin:0 0 1rem;line-height:1.5'
    ));
  }

  reset(weekly, 'Last week at the box office', 'Loading collections…');
  reset(live, 'Live tracker', 'Loading collections…');

  fetch('data/tracker.json', { cache: 'no-cache' })
    .then(function (response) {
      if (!response.ok) throw new Error('Tracker unavailable');
      return response.json();
    })
    .then(function (data) {
      if (
        !Array.isArray(data.films) ||
        !Number.isFinite(Date.parse(data.updatedAt))
      ) {
        throw new Error('Invalid tracker');
      }

      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date(data.updatedAt));

      var dateParts = {};
      parts.forEach(function (part) {
        dateParts[part.type] = part.value;
      });

      var asOf = dateParts.year + '-' +
        dateParts.month + '-' + dateParts.day;

      var today = date(asOf);

      // Find this week's Friday, then the previous Friday–Thursday.
      var currentFriday = add(
        today,
        -((today.getUTCDay() + 2) % 7)
      );

      var start = iso(add(currentFriday, -7));
      var end = iso(add(currentFriday, -1));

      var stale = Date.now() - Date.parse(data.updatedAt) >
        48 * 3600000;

      var updated = new Date(data.updatedAt).toLocaleString();
      var staleText = stale ? ' · Data may be out of date' : '';

      reset(
        weekly,
        'Last week at the box office',
        'India net · ' + showDate(start) + ' – ' + showDate(end) +
        ' · Friday–Thursday · Refreshed ' + updated + staleText
      );

      reset(
        live,
        'Live tracker',
        'Latest reported figures · Refreshed ' + updated + staleText
      );

      var rows = [];
      var cards = [];

      data.films.forEach(function (film) {
        if (
          typeof film.title !== 'string' ||
          !/^https:\/\/www\.sacnilk\.com\/movie\/[A-Za-z0-9_-]+$/.test(
            film.url
          ) ||
          !Array.isArray(film.days)
        ) return;

        var seen = {};

        var days = film.days.filter(function (day) {
          if (
            !day ||
            !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
            !Number.isFinite(day.indiaNet) ||
            seen[day.date]
          ) return false;

          seen[day.date] = true;
          return true;
        }).sort(function (a, b) {
          return a.date.localeCompare(b.date);
        });

        if (!days.length) return;

        var last = days[days.length - 1];

        var week = days.filter(function (day) {
          return day.date >= start && day.date <= end;
        });

        if (week.length) {
          var expectedStart =
            days[0].day === 1 && days[0].date > start
              ? days[0].date
              : start;

          var expected =
            Math.round(
              (date(end) - date(expectedStart)) / 86400000
            ) + 1;

          rows.push({
            film: film,
            amount: week.reduce(function (sum, day) {
              return sum + day.indiaNet;
            }, 0),
            count: week.length,
            expected: expected
          });
        }

        cards.push({ film: film, last: last });
      });

      rows.sort(function (a, b) {
        return b.amount - a.amount;
      });

      var max = rows.length ? rows[0].amount : 0;

      var list = el(
        'div',
        null,
        'border:1px solid #29343c;border-radius:10px;' +
        'overflow:hidden;background:#151e23'
      );

      if (!rows.length) {
        list.append(el(
          'p',
          'No reported daily collections for this week.',
          'padding:1rem;color:#a5afb6'
        ));
      }

      rows.forEach(function (rowData, index) {
        var row = el(
          'div',
          null,
          'display:flex;gap:1rem;align-items:center;' +
          'padding:1rem;border-bottom:1px solid #29343c'
        );

        row.append(el(
          'strong',
          String(index + 1),
          'color:#facc15;font-size:1.1rem;min-width:1.5rem'
        ));

        var body = el('div', null, 'flex:1;min-width:0');

        var name = el(
          'a',
          rowData.film.title,
          'color:#f3f4f6;font-weight:700;text-decoration:none'
        );
        name.href = rowData.film.url;
        name.target = '_blank';
        name.rel = 'noopener noreferrer';
        body.append(name);

        var track = el(
          'div',
          null,
          'height:4px;background:#29343c;border-radius:4px;' +
          'margin-top:.55rem;max-width:340px'
        );

        var width = max > 0
          ? Math.max(0, Math.min(100, rowData.amount / max * 100))
          : 0;

        var bar = el(
          'div',
          null,
          'height:100%;border-radius:4px;background:#facc15;' +
          'width:' + width + '%'
        );

        track.append(bar);
        body.append(track);
        row.append(body);

        var right = el(
          'div',
          null,
          'text-align:right;white-space:nowrap'
        );

        right.append(el('strong', money(rowData.amount), 'color:#facc15'));

        var completeness = rowData.count < rowData.expected
          ? rowData.count + ' of ' + rowData.expected +
            ' days reported · partial'
          : 'Reported days complete';

        right.append(el(
          'div',
          completeness,
          'font-size:.66rem;color:#9aa5ad;margin-top:.3rem'
        ));

        row.append(right);
        list.append(row);
      });

      weekly.append(list);
      weekly.append(el(
        'p',
        'Ranked among films in the tracker feed. ' +
        'Source estimates can change.',
        'font-size:.7rem;color:#87939b;margin-top:.75rem'
      ));

      var grid = el(
        'div',
        null,
        'display:grid;' +
        'grid-template-columns:repeat(auto-fit,minmax(min(100%,350px),1fr));' +
        'gap:12px'
      );

      cards.forEach(function (entry) {
        var card = el(
          'a',
          null,
          'display:block;background:#171f24;border:1px solid #29343c;' +
          'border-radius:10px;padding:1.15rem;color:inherit;' +
          'text-decoration:none'
        );

        card.href = entry.film.url;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';

        card.append(el(
          'h3',
          entry.film.title,
          'margin:0 0 .35rem;font-size:1.1rem;color:#f3f4f6'
        ));

        card.append(el(
          'p',
          'Latest report · Day ' + entry.last.day +
          ' · ' + showDate(entry.last.date),
          'font-size:.72rem;color:#a5afb6;margin:0 0 1rem'
        ));

        var stats = el(
          'div',
          null,
          'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));' +
          'gap:.6rem'
        );

        [
          ['India net', money(entry.film.indiaNet)],
          ['Worldwide', money(entry.film.worldwideGross)],
          ['Latest day', money(entry.last.indiaNet)]
        ].forEach(function (pair) {
          var stat = el(
            'div',
            null,
            'background:#11181d;border-radius:6px;' +
            'padding:.65rem;min-width:0'
          );

          stat.append(el(
            'div',
            pair[0],
            'font-size:.64rem;color:#99a4ab;margin-bottom:.35rem'
          ));

          stat.append(el(
            'strong',
            pair[1],
            'font-size:.85rem;color:#facc15;overflow-wrap:anywhere'
          ));

          stats.append(stat);
        });

        card.append(stats);
        grid.append(card);
      });

      if (!cards.length) {
        grid.append(el(
          'p',
          'No recent daily reports available.',
          'color:#a5afb6'
        ));
      }

      live.append(grid);
    })
    .catch(function () {
      reset(
        weekly,
        'Last week at the box office',
        'Daily data is unavailable.'
      );
      reset(live, 'Live tracker', 'Daily data is unavailable.');
    });
})();
