"""Retrospective day-7 India-net forecast comparison."""

import datetime as dt
import json
import math
import re
import pathlib
import statistics

DATA = pathlib.Path(__file__).resolve().parent / "data"


def load(name):
    with (DATA / name).open(encoding="utf-8") as file:
        return json.load(file)
def find_language(title, year, text):
    pattern = (
        r"\btitle\s*:\s*([\"'])"
        + re.escape(title)
        + r"\1[^{}]{0,200}\byear\s*:\s*"
        + str(year)
        + r"\b[^{}]{0,200}\blang\s*:\s*"
        + r"([\"'])(Hindi|Tamil|Telugu|Malayalam|Kannada)\2"
    )

    languages = {
        match.group(3).lower()
        for match in re.finditer(pattern, text, re.I)
    }

    return next(iter(languages)) if len(languages) == 1 else None




def main():
    index_text = (DATA.parent / "index.html").read_text(
        encoding="utf-8"
    )
    historical = load("historical.json")
    snapshot = load("sacnilk.json")
    try:
        older_totals = load("historical_totals.json")
    except (OSError, ValueError):
        older_totals = {"films": []}

    totals = {}

    for film in (
        snapshot.get("films", []) + older_totals.get("films", [])
    ):
        key = (film.get("url"), film.get("year"))
        value = film.get("indiaNet")

        if (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
            and value > 0
        ):
            totals.setdefault(key, []).append(value)
                # Use the Malayalam label from the verified historical records.
    source_languages = {}

        for film in (
        older_totals.get("films", [])
        + older_totals.get("industryFilms", [])
    ):
        if not isinstance(film, dict):
            continue

        if film.get("industry") == "Malayalam":
            key = (film.get("url"), film.get("year"))
            source_languages.setdefault(key, set()).add("malayalam")

    def resolved_language(film, year):
        key = (film.get("url"), year)
        values = set(source_languages.get(key, set()))

        page_language = find_language(
            film.get("title", ""),
            year,
            index_text,
        )

        if page_language:
            values.add(page_language)

        # Skip the language if the page and reference disagree.
        return next(iter(values)) if len(values) == 1 else None


    samples = []

    for film in historical.get("films", []):
        try:
            year = film["year"]

            if not isinstance(year, int) or year < 2021:
                continue

            matches = totals.get((film["url"], year), [])

            release = dt.date.fromisoformat(film["release"])

            if release.year != year:
                continue

            rows = {}

            for row in film["days"]:
                day = row["day"]
                amount = row["indiaNet"]

                if (
                    not isinstance(day, int)
                    or day < 1
                    or day in rows
                    or not isinstance(amount, (int, float))
                    or isinstance(amount, bool)
                    or not math.isfinite(amount)
                    or amount < 0
                ):
                    raise ValueError("Invalid daily row")

                date = dt.date.fromisoformat(row["date"])
                expected = release + dt.timedelta(days=day - 1)

                if date != expected:
                    raise ValueError("Date mismatch")

                rows[day] = float(amount)

            # The target must have all seven opening days.
            if not all(day in rows for day in range(1, 8)):
                continue

            week1 = sum(rows[day] for day in range(1, 8))
            last_day = max(rows)

            # Do not sum across gaps as though missing days were zero.
            continuous = len(rows) == last_day
            reported_sum = sum(rows.values()) if continuous else None

            if len(matches) == 1:
                actual = matches[0]
            elif len(matches) == 0 and continuous:
                # Use the reported daily sum as a provisional outcome.
                actual = reported_sum
            else:
                continue

            if week1 <= 0 or actual < week1:
                continue

            samples.append({
                "title": film["title"],
                "language": resolved_language(film, year),
                "release": release,
                "last_day": last_day,
                "week1": week1,
                "actual": actual,
                "continuous": continuous,
                "reported_sum": reported_sum,
                "hold": rows[7] / rows[1] if rows[1] else None,
            })

        except (KeyError, TypeError, ValueError, OverflowError):
            continue

    errors = {
        "pooled": [],
        "scale": [],
        "scale_and_hold": [],
        "same_language": [],
    }
    paired_errors = {name: [] for name in errors}
    print("\nDAY-7 FORECAST TEST: EARLIER FILMS ONLY")
    print(
        "Comparable outcomes use current reference totals when available, "
        "or a provisional sum of consecutive daily rows."
    )
    print(
        "Target results use current snapshot totals, which may have "
        "been revised since release.\n"
    )

    for target in sorted(samples, key=lambda item: item["release"]):
        forecast_date = target["release"] + dt.timedelta(days=6)

        # Require the last reported day to be at least 30 days before
        # the target forecast date. This is a conservative filter, but
        # it does not prove the comparable's run was finished.
        peers = [
            peer
            for peer in samples
            if (
                peer is not target
                
                and (
                    peer["release"]
                    + dt.timedelta(days=peer["last_day"] - 1 + 30)
                    <= forecast_date
                )
            )
        ]

        if len(peers) < 2:
            print(
                target["title"],
                ": skipped — fewer than two eligible earlier films",
            )
            continue

        def distance(peer, use_hold):
            score = abs(math.log(peer["week1"] / target["week1"]))

            if use_hold and peer["hold"] and target["hold"]:
                score += abs(math.log(peer["hold"] / target["hold"]))

            return score

        closest_scale = sorted(
            peers,
            key=lambda peer: distance(peer, False),
        )[:3]

        hold_peers = [
            peer
            for peer in peers
            if peer["hold"] and target["hold"]
        ]

        closest_hold = sorted(
            hold_peers,
            key=lambda peer: distance(peer, True),
        )[:3]

        methods = {
            "pooled": peers,
            "scale": closest_scale,
        }

        if len(closest_hold) >= 2:
            methods["scale_and_hold"] = closest_hold
        same_language = [
            peer
            for peer in peers
            if (
                target["language"]
                and peer["language"] == target["language"]
                and peer["hold"]
                and target["hold"]
            )
        ]

        if len(same_language) >= 2:
            methods["same_language"] = sorted(
                same_language,
                key=lambda peer: distance(peer, True),
            )[:3]

        print(
            "\n{} · reported ₹{:.2f} Cr".format(
                target["title"],
                target["actual"],
            )
        )
        target_errors = {}
        for name, group in methods.items():
            multipliers = [
                peer["actual"] / peer["week1"]
                for peer in group
            ]

            multiplier = statistics.median(multipliers)
            estimate = target["week1"] * multiplier
            error = abs(estimate - target["actual"]) / target["actual"] * 100

            errors[name].append(error)
            target_errors[name] = error

            print(
                "  {}: ₹{:.2f} Cr · error {:.1f}% · peers: {}".format(
                    name,
                    estimate,
                    error,
                    ", ".join(peer["title"] for peer in group),
                )
            )
        if all(name in target_errors for name in paired_errors):
            for name in paired_errors:
                paired_errors[name].append(target_errors[name])
    print("\nRESULTS")
    print("Methods can have different sample sizes.")

    for name, values in errors.items():
        if values:
            print(
                "{}: {} films · median absolute error {:.1f}%".format(
                    name,
                    len(values),
                    statistics.median(values),
                )
            )
        else:
            print(name + ": not enough eligible comparisons")
    print("\nPAIRED COMPARISON: SAME FILMS")

    for name, values in paired_errors.items():
        if values:
            print(
                "{}: {} films · median error {:.1f}%".format(
                    name,
                    len(values),
                    statistics.median(values),
                )
            )
        else:
            print(name + ": not enough matched films")
    print(
        "\nExperimental only: language is used only where matched; "
        "actor, director and clash matching and calibrated probabilities "
        "are not implemented."
    )


if __name__ == "__main__":
    main()
