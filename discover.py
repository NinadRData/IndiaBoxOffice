import datetime as dt
from html.parser import HTMLParser
import json
import os
import pathlib
import re
import tempfile
import time
import urllib.request
from zoneinfo import ZoneInfo

from tracker import DayParser

ROOT = pathlib.Path(__file__).resolve().parent
HOST = "https://www.sacnilk.com"
TODAY = dt.datetime.now(ZoneInfo("Asia/Kolkata")).date()

LANGS = {
    "Hindi", "Telugu", "Tamil", "Malayalam", "Kannada",
    "Marathi", "Punjabi", "Bengali", "Gujarati",
    "Assamese", "Odia", "Bhojpuri",
}


class Discovery(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inside = False
        self.links = []
        self.link = None
        self.name = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()

        if tag == "ul" and "ds-runlist" in classes:
            self.inside = True

        if (
            self.inside
            and tag == "a"
            and "ds-lrow__name" in classes
        ):
            path = attrs.get("href", "")
            if re.fullmatch(r"/movie/[A-Za-z0-9_-]+", path):
                self.link = HOST + path
                self.name = []

    def handle_data(self, data):
        if self.link:
            self.name.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.link:
            title = " ".join("".join(self.name).split())
            self.links.append((self.link, title))
            self.link = None

        if tag == "ul":
            self.inside = False


def fetch(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "BoxOfficeIndiaFeed/1.0 (daily film discovery)"
        },
    )

    with urllib.request.urlopen(request, timeout=25) as response:
        if not response.geturl().startswith(HOST + "/"):
            raise ValueError("Unexpected redirect")

        data = response.read(10_000_001)

    if len(data) > 10_000_000:
        raise ValueError("Page too large")

    return data.decode("utf-8")


def main():
    parser = Discovery()
    parser.feed(fetch(HOST + "/latest-boxoffice-collection"))

    if not parser.links:
        raise ValueError(
            "In-cinemas list not found; previous data kept."
        )

    path = ROOT / "data" / "discovered.json"

    if path.exists():
        old = json.loads(path.read_text(encoding="utf-8"))
    else:
        old = {"films": []}

    cache = {
        film["url"]: film
        for film in old.get("films", [])
    }

    # Optional fallback for films missing from the discovery list.
    manual_path = ROOT / "manual-films.json"

    if manual_path.exists():
        manual = json.loads(
            manual_path.read_text(encoding="utf-8")
        )

        if not isinstance(manual, list):
            raise ValueError("manual-films.json must be a list")

        for item in manual:
            if (
                not isinstance(item, dict)
                or not isinstance(item.get("title"), str)
                or not re.fullmatch(
                    r"https://www\.sacnilk\.com/movie/[A-Za-z0-9_-]+",
                    item.get("url", ""),
                )
            ):
                raise ValueError(
                    "Invalid manual film: provide a title "
                    "and a Sacnilk movie URL."
                )

            parser.links.append((item["url"], item["title"]))

    candidates = {}
    for url, title in parser.links:
        candidates[url] = title

    for url, title in candidates.items():
        try:
            time.sleep(1)
            html = fetch(url)

            # Inspect the movie's tags, not the site navigation.
            section = re.search(
                r'<div class="tag-section\b[\s\S]*?</div>\s*</div>',
                html,
            )
            if not section:
                continue

            tags = re.findall(
                r'href="/tag/([^"/?]+)"',
                section.group(0),
            )

            if "Hollywood" in tags or not (set(tags) & LANGS):
                continue

            language = next(
                (tag for tag in tags if tag in LANGS),
                None,
            )

            day_parser = DayParser()
            day_parser.feed(html)

            days = sorted(
                day_parser.days,
                key=lambda day: day["day"],
            )

            if (
                not title
                or len(title) > 150
                or not days
                or any(
                    day["day"] != index + 1
                    for index, day in enumerate(days)
                )
            ):
                continue

            release = days[0]["date"]
            year = int(release[:4])
            latest = dt.date.fromisoformat(days[-1]["date"])

            if (TODAY - latest).days > 14:
                continue

            net = re.search(
                r'ds-stat__k">India net</div>\s*'
                r'<div class="ds-stat__v">₹\s*([\d,.]+)\s*Cr',
                html,
            )

            worldwide = re.search(
                r'ds-hero-fig__lbl">Worldwide gross[^<]*</span>\s*'
                r'<span class="ds-hero-fig__v">₹\s*([\d,.]+)',
                html,
            )

            if not net:
                continue

            cache[url] = {
                "title": title,
                "year": year,
                "language": language,
                "url": url,
                "release": release,
                "indiaNet": float(net.group(1).replace(",", "")),
                "worldwideGross": (
                    float(worldwide.group(1).replace(",", ""))
                    if worldwide else None
                ),
                "days": days,
                "fetchedAt": dt.datetime.now(
                    dt.timezone.utc
                ).isoformat(),
            }

        except (OSError, ValueError, UnicodeError) as error:
            print("Skipping", url, str(error))

    output = {
        "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "films": list(cache.values()),
    }

    with tempfile.NamedTemporaryFile(
        "w",
        dir=path.parent,
        encoding="utf-8",
        delete=False,
    ) as file:
        json.dump(output, file, ensure_ascii=False, indent=2)
        file.write("\n")
        temporary_name = file.name

    os.replace(temporary_name, path)
    print("Stored", len(cache), "discovered films")


if __name__ == "__main__":
    main()
