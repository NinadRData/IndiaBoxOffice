(function () {
  var live = document.getElementById('live-tracker-section');
  if (!live) return;

  var section = document.createElement('section');
  section.id = 'daily-box-office';
  section.style.cssText = 'padding:1.75rem 2rem 0';

  live.parentNode.insertBefore(section, live);

  function node(tag, text, style) {
    var element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (style) element.style.cssText = style;
    return element;
  }

  function currency(value) {
    return Number.isFinite(value)
      ? '₹' + value.toLocaleString('en-IN', {
          maximumFractionDigits: 2
        }) + ' Cr'
      : '—';
  }

  function utc(value) {
    return new Date(value + 'T12:00:00Z');
  }

  function minus(value, days) {
    return new Date(
      utc(value).getTime() - days * 86400000
    ).toISOString().slice(0, 10);
  }

  function displayDate(value) {
    return utc(value).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }

  function change(current, previous) {
    if (
      !Number.isFinite(current) ||
      !Number.isFinite(previous) ||
      previous <= 0
    ) return null;

    return Math.round((current / previous - 1) * 1000) / 10;
  }

  function pct(value) {
    return value == null
      ? '—'
      : (value > 0 ? '+' : '') + value + '%';
  }

  function norm(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function openFilm(film) {
    if (typeof FILM_PAGES === 'undefined') return false;

    var pages = Object.keys(FILM_PAGES)
      .map(function (key) {
        return FILM_PAGES[key];
      })
      .filter(function (page, index, all) {
        return page &&
          page.key &&
          all.indexOf(page) === index &&
          (
            page.sourceUrl === film.url ||
            (
              page.year === film.year &&
              norm(page.title) === norm(film.title)
            )
          );
      });

    if (pages.length !== 1) return false;

    if (
      pages[0].prediction &&
      typeof showFilmPageWithPredictions === 'function'
    ) {
      showFilmPageWithPredictions(pages[0].key);
    } else if (typeof showFilmPage === 'function') {
      showFilmPage(pages[0].key);
    }

    return true;
  }

  var title = node(
    'h2',
    'Daily box office',
    'font-size:1.05rem;letter-spacing:.15em;' +
    'text-transform:uppercase;margin:0 0 .45rem'
  );

  var detail = node(
    'p',
    'Loading daily collections…',
    'color:#a6b0b5;font-size:.76rem;' +
    'line-height:1.5;margin:0 0 1rem'
  );

  var dateLabel = node(
    'label',
    'Report date  ',
    'color:#a6b0b5;font-size:.75rem'
  );

  var select = node(
    'select',
    null,
    'background:#1b242b;color:#fff;border:1px solid #33414a;' +
    'border-radius:5px;padding:.45rem .65rem;margin-bottom:1rem'
  );

  dateLabel.append(select);

  var table = node(
    'div',
    null,
    'overflow-x:auto;background:#161f25;' +
    'border:1px solid #293640;border-radius:8px'
  );

  var note = node(
    'p',
    'Figures are India net estimates for films available in the feed. ' +
    'Totals may be incomplete.',
    'color:#87949c;font-size:.7rem;line-height:1.5;margin:.7rem 0 0'
  );

  section.append(title, detail, dateLabel, table, note);

   window.loadDailyFeeds()
    .then(function (sources) {
      var films = window.resolveDailyFeeds(
        sources[0],
        sources[1]
      );

      var dates = {};

      films.forEach(function (record) {
        record.film.days.forEach(function (day) {
          if (
            day &&
            /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
            Number.isFinite(day.indiaNet) &&
            day.indiaNet >= 0
          ) {
            dates[day.date] = true;
          }
        });
      });

      var options = Object.keys(dates).sort().reverse();

      if (!options.length) {
        detail.textContent = 'No daily reports are available.';
        dateLabel.hidden = true;
        return;
      }

      options.forEach(function (day) {
        var option = node('option', displayDate(day));
        option.value = day;
        select.append(option);
      });

      function render() {
        var selected = select.value;
        var entries = [];

        films.forEach(function (record) {
          var film = record.film;

          var rows = film.days.filter(function (day) {
            return day &&
              /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
              Number.isFinite(day.indiaNet) &&
              day.indiaNet >= 0;
          }).slice().sort(function (a, b) {
            return a.date.localeCompare(b.date);
          });

          var today = rows.find(function (day) {
            return day.date === selected;
          });

          if (!today) return;

          var yesterday = rows.find(function (day) {
            return day.date === minus(selected, 1);
          });

          var lastWeek = rows.find(function (day) {
            return day.date === minus(selected, 7);
          });

          var through = rows.filter(function (day) {
            return day.date <= selected;
          });

          // Only calculate a running total if every day from day one
          // through the selected date is available.
          var complete = through.length > 0 &&
            through.every(function (day, index) {
              return day.day === index + 1 &&
                (
                  index === 0 ||
                  day.date === minus(through[index - 1].date, -1)
                );
            });

          var total = complete
            ? through.reduce(function (sum, day) {
                return sum + day.indiaNet;
              }, 0)
            : null;

          entries.push({
            film: film,
            day: today.day,
            daily: today.indiaNet,
            chg: change(
              today.indiaNet,
              yesterday && yesterday.indiaNet
            ),
            week: change(
              today.indiaNet,
              lastWeek && lastWeek.indiaNet
            ),
            total: total
          });
        });

        entries.sort(function (a, b) {
          return b.daily - a.daily;
        });

        detail.textContent =
          displayDate(selected) +
          ' · India net · ₹ crore · ' +
          entries.length +
          ' film' + (entries.length === 1 ? '' : 's') +
          ' in the available feed';

        table.replaceChildren();

        var grid =
          'display:grid;' +
          'grid-template-columns:42px minmax(160px,2fr) ' +
          'repeat(4,minmax(90px,1fr)) 60px;' +
          'align-items:center;gap:.6rem;min-width:760px;';

        var head = node(
          'div',
          null,
          grid +
          'padding:.65rem 1rem;border-bottom:1px solid #344149;' +
          'color:#8f9ca4;font-size:.65rem;' +
          'text-transform:uppercase;letter-spacing:.08em'
        );

        [
          '#',
          'Film',
          'Daily net',
          'Daily change',
          'Weekly change',
          'Total to date',
          'Day'
        ].forEach(function (label, index) {
          head.append(node(
            'span',
            label,
            index > 1 ? 'text-align:right' : ''
          ));
        });

        table.append(head);

        entries.forEach(function (item, index) {
          var row = node(
            'div',
            null,
            grid +
            'padding:.85rem 1rem;border-bottom:1px solid #26343b;' +
            'font-size:.82rem'
          );

          row.append(node(
            'strong',
            String(index + 1),
            'color:#facc15'
          ));

          var name = node(
            'a',
            item.film.title,
            'color:#f1f5f9;font-weight:700;text-decoration:none'
          );

          name.href = item.film.url;
          name.target = '_blank';
          name.rel = 'noopener noreferrer';

          name.addEventListener('click', function (event) {
            if (openFilm(item.film)) event.preventDefault();
          });

          row.append(name);

          row.append(node(
            'strong',
            currency(item.daily),
            'text-align:right;color:#facc15'
          ));

          [item.chg, item.week].forEach(function (value) {
            var color = value == null
              ? '#91a0a8'
              : value >= 0 ? '#4ade80' : '#f87171';

            row.append(node(
              'span',
              pct(value),
              'text-align:right;color:' + color
            ));
          });

          row.append(node(
            'span',
            currency(item.total),
            'text-align:right;color:#c7d0d4'
          ));

          row.append(node(
            'span',
            String(item.day || '—'),
            'text-align:right;color:#a6b0b5'
          ));

          table.append(row);
        });

        var sum = entries.reduce(function (total, entry) {
          return total + entry.daily;
        }, 0);

        table.append(node(
          'div',
          'Combined reported daily net: ' + currency(sum),
          'min-width:760px;padding:.8rem 1rem;' +
          'text-align:right;color:#aab7bd;font-size:.75rem'
        ));
      }

      select.addEventListener('change', render);
      render();
    })
    .catch(function () {
      detail.textContent = 'Daily data could not be loaded.';
      dateLabel.hidden = true;
    });
})();
