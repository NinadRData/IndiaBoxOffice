import datetime as dt
import html.parser
import json
import pathlib
import re
import tempfile
import os
import time
import urllib.request
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parent
TODAY = dt.datetime.now(ZoneInfo("Asia/Kolkata")).date()


class DayParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_panel = False
        self.panel_depth = 0
        self.row = None
        self.cell = None
        self.days = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)

        if (
            not self.in_panel
            and tag == "div"
            and attrs.get("data-ds-dpanel") == "all"
        ):
            self.in_panel = True
            self.panel_depth = 1
            return

        if not self.in_panel:
            return

        if tag == "div":
            self.panel_depth += 1

        if tag == "tr":
            self.row = []

        if tag == "td" and self.row is not None:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if not self.in_panel:
            return

        if tag == "td" and self.cell is not None:
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
                    r"₹\s*([\d,]+(?:\.\d+)?)\s*Cr(?:\s*\*)?",
                    self.row[1],
                )

                if day and date and amount:
                    month = dt.datetime.strptime(
                        date.group(2), "%b"
                    ).month

                    choices = [
                        dt.date(year, month, int(date.group(1)))
                        for year in (TODAY.year, TODAY.year - 1)
                    ]
                    choices = [date for date in choices if date <= TODAY]

                    if choices:
                        self.days.append({
                            "date": max(choices).isoformat(),
                            "day": int(day.group(1)),
                            "indiaNet": float(
                                amount.group(1).replace(",", "")
                            ),
                        })

            self.row = None

        if tag == "div":
            self.panel_depth -= 1
            if self.panel_depth == 0:
                self.in_panel = False


def main():
    snapshot_path = ROOT / "data" / "sacnilk.json"
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))

    films = []
    failed = []

    for film in snapshot["films"]:
        if (
            film.get("year") != TODAY.year
            or not isinstance(film.get("reportedDay"), int)
            or film["reportedDay"] > 90
        ):
            continue

        url = film.get("url", "")

        if not re.fullmatch(
            r"https://www\.sacnilk\.com/movie/[A-Za-z0-9_-]+",
            url,
        ):
            continue

        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "BoxOfficeIndiaFeed/1.0 (daily snapshot)"
                },
            )

            with urllib.request.urlopen(request, timeout=25) as response:
                if not response.geturl().startswith(
                    "https://www.sacnilk.com/movie/"
                ):
                    raise ValueError("Unexpected redirect")

                page = response.read(10_000_001)

            if len(page) > 10_000_000:
                raise ValueError("Page too large")

            parser = DayParser()
            parser.feed(page.decode("utf-8"))
            days = sorted(parser.days, key=lambda day: day["date"])

            if not days:
                raise ValueError("No daily rows")

            latest = dt.date.fromisoformat(days[-1]["date"])

            if (TODAY - latest).days <= 14:
                films.append({
                    "title": film["title"],
                    "url": url,
                    "year": film["year"],
                    "indiaNet": film["indiaNet"],
                    "worldwideGross": film.get("worldwideGross"),
                    "days": days,
                })

        except (OSError, ValueError, UnicodeError) as error:
            failed.append(film.get("title", url) + ": " + str(error))

        time.sleep(1)

    if failed:
        raise RuntimeError(
            "Daily data incomplete; prior tracker kept. "
            + "; ".join(failed)
        )

    if not films:
        raise RuntimeError(
            "No current daily rows found; prior tracker kept."
        )

    output = {
        "updatedAt": dt.datetime.now(
            dt.timezone.utc
        ).isoformat(),
        "snapshotUpdatedAt": snapshot["updatedAt"],
        "films": films,
    }

    path = ROOT / "data" / "tracker.json"

    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False
    ) as file:
        json.dump(output, file, ensure_ascii=False, indent=2)
        file.write("\n")
        temporary_name = file.name

    os.replace(temporary_name, path)
    print("Saved daily data for", len(films), "films")


if __name__ == "__main__":
    main()
