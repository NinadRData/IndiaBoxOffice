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
    def __init__(self):
        super().__init__()
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
            r"\b(20(?:21|22|23|24))\s+India net\s+₹",
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

    output = {
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
