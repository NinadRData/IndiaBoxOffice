"""Collect explicitly reported worldwide cumulative gross, in ₹ crore."""

import datetime as dt
import html.parser
import json
import math
import os
import pathlib
import re
import tempfile
import time
import urllib.request

from zoneinfo import ZoneInfo


ROOT = pathlib.Path(__file__).resolve().parent
HOST = "https://www.sacnilk.com"
TODAY = dt.datetime.now(ZoneInfo("Asia/Kolkata")).date()
MAX_REPORTS = 30


def fetch(url, prefix):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "BoxOfficeIndiaFeed/1.0 (daily snapshot)"
        },
    )

    with urllib.request.urlopen(request, timeout=25) as response:
        final_url = response.geturl()

        if (
            not final_url.startswith(prefix)
            or final_url.split("?", 1)[0].rstrip("/") != url.rstrip("/")
        ):
            raise ValueError("Unexpected redirect")

        data = response.read(10_000_001)

    if len(data) > 10_000_000:
        raise ValueError("Response too large")

    return data.decode("utf-8")


class ReportLinks(html.parser.HTMLParser):
    def __init__(self, slug):
        super().__init__()

        self.pattern = re.compile(
            r"^/quicknews/"
            + re.escape(slug)
            + r"_Box_Office_Collection_Day_(\d+)$",
            re.I,
        )

        self.links = {}

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return

        path = dict(attrs).get("href", "")
        match = self.pattern.fullmatch(path)

        if match:
            day = int(match.group(1))

            if 1 <= day <= 180:
                self.links[day] = HOST + path


class WorldwideParagraph(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.current = []
        self.paragraphs = []

    def handle_starttag(self, tag, attrs):
        if (
            not self.depth
            and tag == "p"
            and dict(attrs).get("data-sn-para") == "overseas-standing"
        ):
            self.depth = 1
            self.current = []

    def handle_data(self, data):
        if self.depth:
            self.current.append(data)

    def handle_endtag(self, tag):
        if self.depth and tag == "p":
            self.depth = 0
            self.paragraphs.append(
                " ".join(" ".join(self.current).split())
            )


def extract_worldwide(html):
    parser = WorldwideParagraph()
    parser.feed(html)

    if len(parser.paragraphs) != 1:
        return None

    # Accept only a figure explicitly described as worldwide gross.
    matches = re.findall(
        r"\bworldwide\s+gross(?:\s+collection)?\s+to\s*"
        r"₹\s*([\d,]+(?:\.\d+)?)\s*Cr\b",
        parser.paragraphs[0],
        re.I,
    )

    if len(matches) != 1:
        return None

    value = float(matches[0].replace(",", ""))

    return value if math.isfinite(value) and value >= 0 else None


def read_json(path, default):
    if not path.exists():
        return default

    with path.open(encoding="utf-8") as file:
        return json.load(file)

def retry_delayed(record, day, now):
    attempts = record.get("missingReportAttempts", {})

    if not isinstance(attempts, dict):
        return False

    try:
        when = dt.datetime.fromisoformat(
            str(attempts.get(str(day), "")).replace("Z", "+00:00")
        )

        if when.tzinfo is None:
            return False

        elapsed = now - when

        return dt.timedelta(0) <= elapsed < dt.timedelta(days=7)

    except (ValueError, TypeError, OverflowError):
        return False


def record_missing_failure(record, day, when):
    attempts = record.get("missingReportAttempts")

    if not isinstance(attempts, dict):
        attempts = {}
        record["missingReportAttempts"] = attempts

    attempts[str(day)] = when.isoformat()


def main():
    output_path = ROOT / "data" / "worldwide.json"

    old = read_json(output_path, {"films": []})

    if not isinstance(old, dict) or not isinstance(old.get("films"), list):
        raise ValueError(
            "Invalid existing worldwide data; refusing to replace it"
        )

    saved = {}

    for film in old["films"]:
        if not isinstance(film, dict) or not isinstance(film.get("url"), str):
            raise ValueError(
                "Invalid existing film; refusing to replace it"
            )

        saved[film["url"]] = film

    sources = [
        read_json(ROOT / "data" / name, {"films": []})
        for name in ("tracker.json", "discovered.json", "historical.json")
    ]

    active = {}

    for source in sources:
        for film in source.get("films", []):
            if (
                not isinstance(film, dict)
                or not isinstance(film.get("days"), list)
            ):
                continue

            url = film.get("url", "")

            if not re.fullmatch(
                r"https://www\.sacnilk\.com/movie/[A-Za-z0-9_-]+",
                url,
            ):
                continue

            dates = [
                day.get("date")
                for day in film["days"]
                if (
                    isinstance(day, dict)
                    and isinstance(day.get("date"), str)
                    and re.fullmatch(
                        r"\d{4}-\d{2}-\d{2}",
                        day["date"],
                    )
                )
            ]

            try:
                latest = max(
                    dt.date.fromisoformat(date)
                    for date in dates
                )
            except (ValueError, TypeError):
                continue

            age = (TODAY - latest).days

            if age < 0 or (age > 90 and source.get("kind") != "historical"):
                continue

            stamp = (
                film.get("fetchedAt")
                or source.get("updatedAt")
                or ""
            )

            try:
                when = dt.datetime.fromisoformat(
                    stamp.replace("Z", "+00:00")
                )

                if when.tzinfo is None:
                    continue

            except (ValueError, AttributeError):
                continue

            if url not in active or when > active[url][0]:
                active[url] = (when, film, age)

    jobs_recent = []
    jobs_missing = []
    now = dt.datetime.now(dt.timezone.utc)

    for _, film, age in active.values():
        url = film["url"]

        if (
            not isinstance(film.get("title"), str)
            or not isinstance(film.get("year"), int)
        ):
            continue

        slug = url.rsplit("/", 1)[-1]

        try:
            parser = ReportLinks(slug)
            parser.feed(fetch(url, HOST + "/movie/"))

        except (OSError, ValueError, UnicodeError) as error:
            print(
                "Movie report links unavailable:",
                film["title"],
                str(error),
            )
            continue

        existing = saved.get(
            url,
            {
                "url": url,
                "title": film["title"],
                "year": film["year"],
                "points": [],
            },
        )

        if not isinstance(existing.get("points"), list):
            raise ValueError(
                "Invalid existing points; refusing to replace data"
            )

        saved[url] = existing

        existing_days = {
            point.get("day")
            for point in existing["points"]
            if isinstance(point, dict)
        }

        reported_days = {
            day.get("day")
            for day in film["days"]
            if (
                isinstance(day, dict)
                and isinstance(day.get("day"), int)
            )
        }

        available = sorted(set(parser.links) & reported_days)

        if not available:
            continue

        # Refresh recent reports for active films. For older films,
        # use the request budget to fill missing historical days.
        recent = set(available[-3:]) if age <= 14 else set()

        for day in available:
            job = (
                film,
                day,
                parser.links[day],
                available[-1] - day,
            )

            if day in recent:
                jobs_recent.append(job)
            elif (
                day not in existing_days
                and not retry_delayed(existing, day, now)
            ):
                jobs_missing.append(job)

    # Rotate films so a large release slate does not always
    # prioritize the same titles.
    urls = sorted({
        job[0]["url"]
        for job in jobs_recent + jobs_missing
    })

    if urls:
        shift = TODAY.toordinal() % len(urls)
        urls = urls[shift:] + urls[:shift]

    order = {
        url: index
        for index, url in enumerate(urls)
    }

    jobs_recent.sort(
        key=lambda job: (
            job[3],
            order[job[0]["url"]],
        )
    )

    jobs_missing.sort(
        key=lambda job: (
            job[1],
            order[job[0]["url"]],
        )
    )

    recent_limit = min(20, MAX_REPORTS, len(jobs_recent))

    chosen = (
        jobs_recent[:recent_limit]
        + jobs_missing[:MAX_REPORTS - recent_limit]
    )

    if len(chosen) < MAX_REPORTS:
        chosen += jobs_recent[
            recent_limit:
            recent_limit + MAX_REPORTS - len(chosen)
        ]

    attempted = 0
    updated = 0

    for film, day, report, _ in chosen:
        attempted += 1
        record = saved[film["url"]]

        was_missing = not any(
            isinstance(point, dict) and point.get("day") == day
            for point in record["points"]
        )

        try:
            text = fetch(report, HOST + "/quicknews/")
            amount = extract_worldwide(text)

            if amount is None:
                if was_missing:
                    record_missing_failure(record, day, now)

                print(
                    "No explicit worldwide cumulative figure:",
                    film["title"],
                    day,
                )
                continue

            record = saved[film["url"]]

            # Keep the previous successful value if a fetch fails.
            record["points"] = [
                point
                for point in record["points"]
                if not (
                    isinstance(point, dict)
                    and point.get("day") == day
                )
            ]

            record["points"].append({
                "day": day,
                "worldwideGross": amount,
                "reportUrl": report,
                "fetchedAt": dt.datetime.now(
                    dt.timezone.utc
                ).isoformat(),
            })

            record["points"].sort(
                key=lambda point: point["day"]
            )

            attempts = record.get("missingReportAttempts")

            if isinstance(attempts, dict):
                attempts.pop(str(day), None)

            updated += 1

        except (OSError, ValueError, UnicodeError) as error:
            if was_missing:
                record_missing_failure(record, day, now)

            print(
                "Worldwide report unavailable:",
                film["title"],
                day,
                str(error),
            )

        finally:
            time.sleep(0.25)

    output = {
        "updatedAt": dt.datetime.now(
            dt.timezone.utc
        ).isoformat(),
        "films": list(saved.values()),
    }

    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=output_path.parent,
        delete=False,
    ) as file:
        json.dump(output, file, ensure_ascii=False, indent=2)
        file.write("\n")
        temporary = file.name

    os.replace(temporary, output_path)

    print(
        "Worldwide reports checked:",
        attempted,
        "updated:",
        updated,
    )


if __name__ == "__main__":
    main()
