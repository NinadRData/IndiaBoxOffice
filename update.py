#!/usr/bin/env python3
"""Update the public current-year Sacnilk collection snapshot."""

import datetime
import html.parser
import json
import os
import pathlib
import re
import tempfile
import urllib.request

URL = "https://www.sacnilk.com/latest-boxoffice-collection"
OUT = pathlib.Path(__file__).parent / "data" / "sacnilk.json"


class Parser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.row = None
        self.depth = 0
        self.capture = None
        self.buffer = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()

        if self.row is None and tag == "li" and "ds-lrow" in classes:
            self.row = {}
            self.depth = 1
            return

        if self.row is None:
            return

        if tag == "li":
            self.depth += 1

        if tag == "a" and "ds-lrow__name" in classes:
            self.row["url"] = (
                "https://www.sacnilk.com" + attrs.get("href", "")
            )
            self.capture = "title"
            self.buffer = []

        elif "ds-fig" in classes:
            self.capture = "indiaNet"
            self.buffer = []

    def handle_data(self, data):
        if self.capture:
            self.buffer.append(data)

    def handle_endtag(self, tag):
        if self.row is None:
            return

        finished = (
            (self.capture == "title" and tag == "a")
            or (self.capture == "indiaNet" and tag == "span")
        )

        if self.capture and finished:
            value = " ".join("".join(self.buffer).split())

            if self.capture == "indiaNet":
                match = re.fullmatch(
                    r"₹\s*([\d,]+(?:\.\d+)?)\s*Cr", value
                )
                if match:
                    self.row["indiaNet"] = float(
                        match.group(1).replace(",", "")
                    )
            else:
                self.row["title"] = value

            self.capture = None

        if tag == "li":
            self.depth -= 1

            if self.depth == 0:
                if (
                    self.row.get("title")
                    and self.row.get("url", "").startswith(
                        "https://www.sacnilk.com/movie/"
                    )
                    and "indiaNet" in self.row
                ):
                    self.rows.append(self.row)

                self.row = None


def main():
    request = urllib.request.Request(
        URL,
        headers={
            "User-Agent": (
                "BoxOfficeIndiaFeed/1.0 "
                "(daily public collection snapshot)"
            )
        },
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        host = response.geturl().split("/")[2]
        if host not in ("www.sacnilk.com", "sacnilk.com"):
            raise ValueError("Unexpected redirect")

        page = response.read(10_000_001)

    if len(page) > 10_000_000:
        raise ValueError("Page too large")

    parser = Parser()
    parser.feed(page.decode("utf-8"))

    # Remove duplicate mobile/desktop entries.
    rows = list(
        {row["url"]: row for row in reversed(parser.rows)}.values()
    )[::-1]

    if len(rows) < 10:
        raise ValueError(
            "Too few rows found. The source layout may have changed. "
            "The existing snapshot has been kept."
        )

    payload = {
        "source": URL,
        "updatedAt": datetime.datetime.now(
            datetime.timezone.utc
        ).isoformat(),
        "unit": "INR crore",
        "metric": "India net",
        "films": rows,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=OUT.parent, delete=False
    ) as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")
        temporary_name = file.name

    os.replace(temporary_name, OUT)
    print(f'Updated {len(rows)} films at {payload["updatedAt"]}')


if __name__ == "__main__":
    main()
