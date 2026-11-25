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
    # Add a 2025 industry total only if the main snapshot
    # does not already contain the same film.
    snapshot_urls = None

    try:
        snapshot = json.loads(
            (ROOT / "data" / "sacnilk.json").read_text(encoding="utf-8")
        )

        films = snapshot.get("films")

        if isinstance(films, list):
            snapshot_urls = {
                film["url"]
                for film in films
                if (
                    isinstance(film, dict)
                    and film.get("year") == 2025
                    and isinstance(film.get("url"), str)
                )
            }

    except (OSError, ValueError, AttributeError):
        pass

    def eligible_total(film):
        if film.get("year", 0) <= 2024:
            return True

        return (
            film.get("year") == 2025
            and snapshot_urls is not None
            and film.get("url") not in snapshot_urls
        )

    # Preserve last successful industry data if either source is unavailable.
    previous_path = ROOT / "data" / "historical_totals.json"

    try:
        previous = json.loads(
            previous_path.read_text(encoding="utf-8")
        )

        if not isinstance(previous, dict):
            previous = {}

    except (OSError, ValueError):
        previous = {}

    def preserve_industry(industry):
        known_urls = {film["url"] for film in parser.films}

        for film in previous.get("films", []):
            if (
                not isinstance(film, dict)
                or film.get("industry") != industry
                or not eligible_total(film)
            ):
                continue

            url = film.get("url")

            if isinstance(url, str) and url not in known_urls:
                parser.films.append(film)
                known_urls.add(url)

        return [
            film
            for film in previous.get("industryFilms", [])
            if (
                isinstance(film, dict)
                and film.get("industry") == industry
            )
        ]

    previous_labels = []

    # Add Malayalam films from Sacnilk's worldwide list.
    malayalam_url = (
        "https://www.sacnilk.com/"
        "box-office-records/mollywood-100cr-club-worldwide"
    )

    malayalam = Records(include_recent=True)

    try:
        request = urllib.request.Request(
            malayalam_url,
            headers={"User-Agent": "BoxOfficeIndiaFeed/1.0"},
        )

        with urllib.request.urlopen(request, timeout=30) as response:
            final_url = response.geturl().split("?", 1)[0].rstrip("/")

            if final_url != malayalam_url.rstrip("/"):
                raise ValueError("Unexpected Malayalam-list redirect")

            content = response.read(10_000_001)

        if len(content) > 10_000_000:
            raise ValueError("Malayalam records page too large")

        malayalam.feed(content.decode("utf-8"))

        if not malayalam.films:
            raise ValueError("No supported Malayalam records found")

        known_urls = {film["url"] for film in parser.films}

        for film in malayalam.films:
            film["industry"] = "Malayalam"

            if (
                eligible_total(film)
                and film["url"] not in known_urls
            ):
                parser.films.append(film)
                known_urls.add(film["url"])

        print(
            "Malayalam reference records found:",
            len(malayalam.films),
        )

    except (OSError, ValueError, UnicodeError) as error:
        print("Malayalam reference list unavailable:", str(error))
        malayalam.films = []
        previous_labels.extend(preserve_industry("Malayalam"))

    # Add Kannada films from Sacnilk's worldwide list.
    kannada = Records(include_recent=True)

    kannada_url = (
        "https://www.sacnilk.com/"
        "box-office-records/sandalwood-100cr-club-worldwide"
    )

    try:
        request = urllib.request.Request(
            kannada_url,
            headers={"User-Agent": "BoxOfficeIndiaFeed/1.0"},
        )

        with urllib.request.urlopen(request, timeout=30) as response:
            final_url = response.geturl().split("?", 1)[0].rstrip("/")

            if final_url != kannada_url.rstrip("/"):
                raise ValueError("Unexpected Kannada-list redirect")

            content = response.read(10_000_001)

        if len(content) > 10_000_000:
            raise ValueError("Kannada records page too large")

        kannada.feed(content.decode("utf-8"))

        if not kannada.films:
            raise ValueError("No supported Kannada records found")

        known_urls = {film["url"] for film in parser.films}

        for film in kannada.films:
            film["industry"] = "Kannada"

            if (
                eligible_total(film)
                and film["url"] not in known_urls
            ):
                parser.films.append(film)
                known_urls.add(film["url"])

        print(
            "Kannada reference records found:",
            len(kannada.films),
        )

    except (OSError, ValueError, UnicodeError) as error:
        print("Kannada reference list unavailable:", str(error))
        kannada.films = []
        previous_labels.extend(preserve_industry("Kannada"))

    output = {
        "industryFilms": [
            {
                "url": film["url"],
                "year": film["year"],
                "industry": "Malayalam",
            }
            for film in malayalam.films
        ] + [
            {
                "url": film["url"],
                "year": film["year"],
                "industry": "Kannada",
            }
            for film in kannada.films
        ] + previous_labels,
        "source": URL,
        "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "metric": "India net",
        "unit": "INR crore",
        "films": parser.films,
    }

    path = ROOT / "data" / "historical_totals.json"

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
    print("Saved", len(parser.films), "historical reference totals")


if __name__ == "__main__":
    main()
