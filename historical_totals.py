      """Collect older India-net reference totals from Sacnilk's records page."""

import datetime as dt
import html.parser
import json
import os
import pathlib
import re
import tempfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
URL = (
    "https://www.sacnilk.com/"
    "box-office-records/indian-100cr-club-india-net"
)


class Records(html.parser.HTMLParser):
    def __init__(self, include_recent=False):
        super().__init__()
        self.include_recent = include_recent
        self.row = None
        self.depth = 0
        self.in_title = False
        self.films = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()

        if tag == "li" and "ds-lrow" in classes:
            if self.row is None:
                self.row = {"text": [], "title": []}
                self.depth = 1
            else:
                self.depth += 1

        elif self.row is not None and tag == "li":
            self.depth += 1

        if (
            self.row is not None
            and tag == "a"
            and "ds-lrow__name" in classes
        ):
            self.row["url"] = (
                "https://www.sacnilk.com" + attrs.get("href", "")
            )
            self.in_title = True

    def handle_data(self, data):
        if self.row is not None:
            self.row["text"].append(data)

            if self.in_title:
                self.row["title"].append(data)

    def handle_endtag(self, tag):
        if self.row is None:
            return

        if tag == "a":
            self.in_title = False

        if tag != "li":
            return

        self.depth -= 1

        if self.depth != 0:
            return

        row = self.row
        self.row = None

        text = " ".join(" ".join(row["text"]).split())
        title = " ".join(" ".join(row["title"]).split())

        year = re.search(
            r"\b(20\d{2})\s+(?:India net|Worldwide gross)\s+₹",
            text,
        )

        net = re.search(
            r"India net\s+₹\s*([\d,]+(?:\.\d+)?)\s*Cr\b",
            text,
        )

        url = row.get("url", "")

        if (
            year
            and net
            and int(year.group(1)) >= 2021
            and (int(year.group(1)) <= 2024 or self.include_recent)
            and title
            and re.fullmatch(
                r"https://www\.sacnilk\.com/movie/[A-Za-z0-9_-]+",
                url,
            )
        ):
            self.films.append({
                "title": title,
                "year": int(year.group(1)),
                "url": url,
                "indiaNet": float(net.group(1).replace(",", "")),
            })


def main():
    request = urllib.request.Request(
        URL,
        headers={"User-Agent": "BoxOfficeIndiaFeed/1.0"},
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        final_url = response.geturl().split("?", 1)[0].rstrip("/")

        if final_url != URL.rstrip("/"):
            raise ValueError("Unexpected redirect")

        content = response.read(10_000_001)

    if len(content) > 10_000_000:
        raise ValueError("Records page too large")

    parser = Records()
    parser.feed(content.decode("utf-8"))

    # Protect the last saved file if the source changes or is incomplete.
    if len(parser.films) < 10:
        raise ValueError(
            "Too few historical records found; previous file retained"
        )
    # Preserve last successful industry data if either source is unavailable.
    previous_path = ROOT / "data" / "historical_totals.json"
    try:
        previous = json.loads(previous_path.read_text(encoding="utf-8"))
        if not isinstance(previous, dict):
            previous = {}
    except (OSError, ValueError):
        previous = {}

    def preserve_industry(industry):
        known_urls = {film["url"] for film in parser.films}
        for film in previous.get("films", []):
            if not isinstance(film, dict) or film.get("industry") != industry:
                continue
            url = film.get("url")
            if isinstance(url, str) and url not in known_urls:
                parser.films.append(film)
                known_urls.add(url)
        return [
            film for film in previous.get("industryFilms", [])
            if isinstance(film, dict) and film.get("industry") == industry
        ]

    previous_labels = []
    # Add 2021–2024 Malayalam films from Sacnilk's worldwide list.
