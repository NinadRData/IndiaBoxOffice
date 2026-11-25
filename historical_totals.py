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
    # Add 2021–2024 Malayalam films from Sacnilk's worldwide list.
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
            if film["year"] <= 2024 and film["url"] not in known_urls:
                parser.films.append(film)
                known_urls.add(film["url"])

        print(
            "Malayalam reference records found:",
            len(malayalam.films),
        )

    except (OSError, ValueError, UnicodeError) as error:
        print("Malayalam reference list unavailable:", str(error))

        # Preserve previously saved reference rows if this source fails.
        previous_path = ROOT / "data" / "historical_totals.json"

        if previous_path.exists():
            try:
                previous = json.loads(
                    previous_path.read_text(encoding="utf-8")
                )
                known_urls = {film["url"] for film in parser.films}

                for film in previous.get("films", []):
                    url = film.get("url")

                    if url and url not in known_urls:
                        parser.films.append(film)
                        known_urls.add(url)

            except (OSError, ValueError, AttributeError):
                print("Could not read previous reference records")


    output = {
        "industryFilms": [
            {
                "url": film["url"],
                "year": film["year"],
                "industry": "Malayalam",
            }
            for film in malayalam.films
        ],
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
