"""Report conflicts between manual page dates and historical feed dates."""

import datetime as dt
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent

history = json.loads(
    (ROOT / "data" / "historical.json").read_text(encoding="utf-8")
)

html = (ROOT / "index.html").read_text(encoding="utf-8")

compared = 0
conflicts = []
ambiguous = 0

for film in history.get("films", []):
    if not isinstance(film, dict):
        continue

    title = film.get("title")
    year = film.get("year")
    source_date = film.get("release")

    if (
        not isinstance(title, str)
        or not isinstance(year, int)
        or not isinstance(source_date, str)
    ):
        continue

    try:
        dt.date.fromisoformat(source_date)
    except ValueError:
        continue

    pattern = (
        r"\btitle\s*:\s*(['\"])"
        + re.escape(title)
        + r"\1\s*,\s*year\s*:\s*"
        + str(year)
        + r"\b"
    )

    dates = set()

    for match in re.finditer(pattern, html, re.I):
        window = html[match.end():match.end() + 3000]

        release = re.search(
            r"\brelease\s*:\s*(['\"])(\d{4}-\d{2}-\d{2})\1",
            window,
        )

        if release:
            dates.add(release.group(2))

    if len(dates) > 1:
        ambiguous += 1
        continue

    if not dates:
        continue

    compared += 1
    page_date = next(iter(dates))

    if page_date != source_date:
        conflicts.append((title, year, page_date, source_date))

print(
    "Compared:", compared,
    "| Ambiguous:", ambiguous,
    "| Conflicts:", len(conflicts),
)

for title, year, page_date, source_date in conflicts:
    print(
        f"{title} ({year}): "
        f"page {page_date}; historical feed {source_date}"
    )

print(
    "Only exact title/year matches with a nearby release field "
    "are checked."
)
print(
    "A conflict requires review; this report does not change film data."
)
