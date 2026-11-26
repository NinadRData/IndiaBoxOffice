"""Build a verified historical India-net data library from Sacnilk."""

import datetime as dt
import html.parser
import json
import os
import pathlib
import re
import tempfile
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
HOST = "https://www.sacnilk.com"

# Add more films here after verifying their title, year, and Sacnilk URL.
SOURCES = [
    {
        "title": "Lokah: Chapter 1 – Chandra",
        "year": 2025,
        "url": HOST + "/movie/Lokah_Chapter_1_2025",
    },
    {
        "title": "Vaazha 2: Biopic of a Billion Bros",
        "year": 2026,
        "url": HOST + "/movie/Vaazha_2_Biopic_of_a_Billion_Bros_2026",
    },
        {
        "title": "Jawan",
        "year": 2023,
        "url": HOST + "/movie/Jawan_2023",
    },
    {
        "title": "Pathaan",
        "year": 2023,
        "url": HOST + "/movie/Pathan_2022",
    },
    {
        "title": "RRR",
        "year": 2022,
        "url": HOST + "/movie/RRR_2020",
    },
    {
        "title": "KGF Chapter 2",
        "year": 2022,
        "url": HOST + "/movie/KGF_Chapter_2_2020",
    },
]


class Rows(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.panel = False
        self.depth = 0
        self.row = None
        self.cell = None
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)

        if (
            not self.panel
            and tag == "div"
            and attrs.get("data-ds-dpanel") == "all"
        ):
            self.panel = True
            self.depth = 1
            return

        if not self.panel:
            return

        if tag == "div":
            self.depth += 1

        if tag == "tr":
            self.row = []

        if tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if not self.panel:
            return

        if tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join(" ".join(self.cell).split()))
            self.cell = None

        if tag == "tr" and self.row is not None:
            if len(self.row) >= 2:
                day = re.search(r"\bDay\s+(\d+)\b", self.row[0])

                date = re.search(
                    r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+"
                    r"(\d{1,2})\s+"
                    r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b",
                    self.row[0],
                )

                amount = re.fullmatch(
                    r"₹\s*([\d,]+(?:\.\d+)?)\s*(Cr|L)(?:\s*\*)?",
                    self.row[1],
                    re.I,
                )

                if day and date and amount:
                    value = float(amount.group(1).replace(",", ""))

                    if amount.group(2).lower() == "l":
                        value /= 100

                    self.rows.append(
                        (
                            int(day.group(1)),
                            int(date.group(1)),
                            dt.datetime.strptime(date.group(2), "%b").month,
                            value,
                        )
                    )

            self.row = None

        if tag == "div":
            self.depth -= 1
            if self.depth == 0:
                self.panel = False


def parse(html, source):
    config = re.search(
        r'<script[^>]*id="ratingWidgetConfig"[^>]*>(.*?)</script>',
        html,
        re.S,
    )

    if not config:
        raise ValueError("No release date metadata")

    release = (
        json.loads(config.group(1))
        .get("targets", {})
        .get("movie", {})
        .get("open_date")
    )

    start = dt.date.fromisoformat(release)

    if start.year != source["year"]:
        raise ValueError("Release year mismatch")

    parser = Rows()
    parser.feed(html)

    if not parser.rows:
        raise ValueError("No daily rows")

    result = []
    seen = set()

    for day, date, month, amount in parser.rows:
        if day < 1:
            continue

        actual = start + dt.timedelta(days=day - 1)

        if (
            actual.day != date
            or actual.month != month
            or day in seen
            or amount < 0
        ):
            raise ValueError("Unexpected day or duplicate")

        seen.add(day)
        result.append(
            {
                "day": day,
                "date": actual.isoformat(),
                "indiaNet": amount,
            }
        )

    result.sort(key=lambda row: row["day"])

    if not result or result[0]["day"] != 1:
        raise ValueError("Missing day 1")

    return {
        "title": source["title"],
        "year": source["year"],
        "url": source["url"],
        "release": release,
        "days": result,
        "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def main():
    path = ROOT / "data" / "historical.json"

    if path.exists():
        old = json.loads(path.read_text(encoding="utf-8"))
    else:
        old = {"films": []}

    if not isinstance(old, dict) or not isinstance(old.get("films"), list):
        raise ValueError("Invalid previous historical data")

    saved = {film["url"]: film for film in old["films"]}
    updated = 0

        # Begin with the manually verified seed films.
    sources = list(SOURCES)
    known_urls = {film["url"] for film in sources}

    # Discover 2025 films from the existing box-office snapshot.
    snapshot_path = ROOT / "data" / "sacnilk.json"

    try:
        if snapshot_path.exists():
            snapshot = json.loads(
                snapshot_path.read_text(encoding="utf-8")
            )

            films = snapshot.get("films", [])

            if not isinstance(films, list):
                raise ValueError("Snapshot films must be a list")

            for film in films:
                if not isinstance(film, dict):
                    continue

                title = film.get("title")
                year = film.get("year")
                url = film.get("url")

                if (
                    year != 2025
                    or not isinstance(title, str)
                    or not title.strip()
                    or not isinstance(url, str)
                    or not re.fullmatch(
                        r"https://www\.sacnilk\.com/movie/[A-Za-z0-9_-]+",
                        url,
                    )
                    or url in known_urls
                ):
                    continue

                sources.append({
                    "title": title,
                    "year": year,
                    "url": url,
                })

                known_urls.add(url)

    except (OSError, ValueError, TypeError, AttributeError) as error:
        print("Could not read snapshot candidates:", str(error))
            # Find older films that already have an unambiguous title and year
    # in the site's existing film data.
    totals_path = ROOT / "data" / "historical_totals.json"
    index_path = ROOT / "index.html"

    try:
        if totals_path.exists() and index_path.exists():
            totals_data = json.loads(
                totals_path.read_text(encoding="utf-8")
            )

            index_text = index_path.read_text(encoding="utf-8")
            candidates = []

            for film in totals_data.get("films", []):
                if not isinstance(film, dict):
                    continue

                title = film.get("title")
                year = film.get("year")
                url = film.get("url")

                if (
                    not isinstance(title, str)
                    or not title.strip()
                    or not isinstance(year, int)
                    or not 2021 <= year <= 2024
                    or not isinstance(url, str)
                    or not re.fullmatch(
                        r"https://www\.sacnilk\.com/movie/[A-Za-z0-9_-]+",
                        url,
                    )
                    or url in known_urls
                    or url in saved
                ):
                    continue

                # Match a title followed by its year in the same
                # simple film object. Skip uncertain or duplicate matches.
                pattern = (
                    r"\btitle\s*:\s*([\"'])"
                    + re.escape(title)
                    + r"\1[^{}]{0,200}\byear\s*:\s*"
                    + str(year)
                    + r"\b"
                )

                if len(re.findall(pattern, index_text, re.I)) != 1:
                    continue

                candidates.append({
                    "title": title,
                    "year": year,
                    "url": url,
                })

            # Rotate the starting point each day so a failing source
            # does not permanently block later candidates.
            candidates.sort(key=lambda item: item["url"])

            if candidates:
                offset = (
                    dt.datetime.now(dt.timezone.utc).date().toordinal() * 5
                ) % len(candidates)

                candidates = candidates[offset:] + candidates[:offset]

            for film in candidates[:5]:
                if film["url"] not in known_urls:
                    sources.append(film)
                    known_urls.add(film["url"])

            print(
                "Older database matches queued:",
                min(5, len(candidates)),
            )

    except (OSError, ValueError, TypeError, AttributeError) as error:
        print("Could not select older database matches:", str(error))

    # Queue older Malayalam films from the verified industry list.
    malayalam_candidates = []

    try:
        totals_path = ROOT / "data" / "historical_totals.json"

        if totals_path.exists():
            reference = json.loads(
                totals_path.read_text(encoding="utf-8")
            )
                        labels = {}

            for item in reference.get("industryFilms", []):
                if (
                    isinstance(item, dict)
                    and item.get("industry") in ("Malayalam", "Kannada")
                ):
                    key = (item.get("url"), item.get("year"))
                    labels.setdefault(key, set()).add(item["industry"])

            for film in reference.get("films", []):
                if not isinstance(film, dict):
                    continue

                title = film.get("title")
                year = film.get("year")
                url = film.get("url")

                industries = set(labels.get((url, year), set()))

                if film.get("industry") in ("Malayalam", "Kannada"):
                    industries.add(film["industry"])

                if (
                    len(industries) != 1
                    or not isinstance(title, str)
                    or not title.strip()
                    or not isinstance(year, int)
                    or not 2021 <= year <= 2024
                    or not isinstance(url, str)
                    or not re.fullmatch(
                        r"https://www\.sacnilk\.com/movie/[A-Za-z0-9_-]+",
                        url,
                    )
                    or url in known_urls
                    or url in saved
                ):
                    continue

                malayalam_candidates.append({
                    "title": title,
                    "year": year,
                    "url": url,
                })

            malayalam_candidates.sort(key=lambda film: film["url"])

            if malayalam_candidates:
                offset = (
                    dt.datetime.now(dt.timezone.utc).date().toordinal() * 3
                ) % len(malayalam_candidates)

                malayalam_candidates = (
                    malayalam_candidates[offset:]
                    + malayalam_candidates[:offset]
                )

            for film in malayalam_candidates[:3]:
                if film["url"] not in known_urls:
                    sources.append(film)
                    known_urls.add(film["url"])

            print(
                "Malayalam candidates queued:",
                min(3, len(malayalam_candidates)),
            )

    except (OSError, ValueError, TypeError, AttributeError) as error:
        print("Could not select Malayalam candidates:", str(error))

    print("Historical candidates:", len(sources))

    for source in sources:
        previous = saved.get(source["url"])

        # Recheck existing historical films roughly every 30 days.
        if previous:
            try:
                last = dt.datetime.fromisoformat(
                    previous.get("fetchedAt", "").replace("Z", "+00:00")
                )

                if (
                    last.tzinfo
                    and (
                        dt.datetime.now(dt.timezone.utc) - last
                    ).total_seconds() < 30 * 86400
                ):
                    continue
            except (ValueError, AttributeError):
                pass

        try:
            request = urllib.request.Request(
                source["url"],
                headers={"User-Agent": "BoxOfficeIndiaFeed/1.0 (daily snapshot)"},
            )

            with urllib.request.urlopen(request, timeout=25) as response:
                final_url = response.geturl().split("?", 1)[0].rstrip("/")

                if final_url != source["url"].rstrip("/"):
                    raise ValueError("Unexpected redirect")

                content = response.read(10_000_001)

            if len(content) > 10_000_000:
                raise ValueError("Page too large")

            parsed = parse(content.decode("utf-8"), source)

            # Keep an existing longer history if a new scrape is incomplete.
            if previous and len(parsed["days"]) < len(previous.get("days", [])):
                print("Shorter scrape; retaining previous:", source["title"])
                continue

            saved[source["url"]] = parsed
            updated += 1
            print(source["title"], len(parsed["days"]), "daily rows")

        except (OSError, ValueError, UnicodeError, TypeError, KeyError) as error:
            print("Historical collection failed:", source["title"], str(error))

        time.sleep(0.5)

    if not updated:
        print("No historical changes")
        return

    output = {
        "kind": "historical",
        "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "films": list(saved.values()),
    }

    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=path.parent,
        delete=False,
    ) as file:
        json.dump(output, file, ensure_ascii=False, indent=2)
        file.write("\n")
        temporary = file.name

    os.replace(temporary, path)


if __name__ == "__main__":
    main()
