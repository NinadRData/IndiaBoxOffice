"""Retrospective same-day live forecast test."""

import datetime as dt
import json
import math
import os
import pathlib
import statistics

from backtest_history import find_language

ROOT = pathlib.Path(__file__).resolve().parent


def read(name):
    with (ROOT / "data" / name).open(encoding="utf-8") as file:
        return json.load(file)


def main():
    history = read("historical.json")
    older_totals = read("historical_totals.json")
    snapshot = read("sacnilk.json")
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    totals = {}
    industry_languages = {}

    for film in (
        older_totals.get("films", []) + snapshot.get("films", [])
    ):
        amount = film.get("indiaNet")

        if (
            isinstance(amount, (int, float))
            and not isinstance(amount, bool)
            and math.isfinite(amount)
            and amount > 0
        ):
            key = (film.get("url"), film.get("year"))
            totals.setdefault(key, []).append(amount)


    for film in (
        older_totals.get("films", [])
        + older_totals.get("industryFilms", [])
    ):
        if film.get("industry") in ("Malayalam", "Kannada", "Tamil", "Telugu", "Hindi"):
            key = (film.get("url"), film.get("year"))

            industry_languages.setdefault(key, set()).add(
                film["industry"].lower()
            )

    films = []

    for film in history.get("films", []):
        try:
            year = film["year"]
            release = dt.date.fromisoformat(film["release"])
            key = (film["url"], year)

            if (
                not isinstance(year, int)
                or year < 2021
                or release.year != year
                or len(totals.get(key, [])) != 1
            ):
                continue

            labels = set()
            page_language = find_language(film["title"], year, html)

            if page_language:
                labels.add(page_language)

            reported = str(film.get("language") or "").lower()

            if reported in (
                "hindi", "tamil", "telugu", "malayalam", "kannada"
            ):
                labels.add(reported)

            labels.update(industry_languages.get(key, set()))

            if len(labels) != 1:
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

                expected = release + dt.timedelta(days=day - 1)

                if dt.date.fromisoformat(row["date"]) != expected:
                    raise ValueError("Date mismatch")

                rows[day] = amount

            if not all(day in rows for day in range(1, 8)):
                continue

            first_week = sum(rows[day] for day in range(1, 8))
            total = totals[key][0]

            if (
                first_week <= 0
                or rows[1] <= 0
                or rows[7] <= 0
                or total < first_week
            ):
                continue

            films.append({
                "title": film["title"],
                "key": key,
                "release": release,
                "last": max(rows),
                "rows": rows,
                "week": first_week,
                "hold": rows[7] / rows[1],
                "total": total,
                "language": next(iter(labels)),
            })

        except (KeyError, ValueError, TypeError, OverflowError):
            continue

    for forecast_day in (7, 14, 21):
        errors = []
        by_language = {}
        covered = 0

        print("\nDAY", forecast_day)

        for target in sorted(films, key=lambda film: film["release"]):
            if not all(
                day in target["rows"]
                for day in range(1, forecast_day + 1)
            ):
                continue

            banked = sum(
                target["rows"][day]
                for day in range(1, forecast_day + 1)
            )

            if banked > target["total"]:
                continue

            as_of = target["release"] + dt.timedelta(
                days=forecast_day - 1
            )

            peers = []

            for peer in films:
                if (
                    peer["key"] == target["key"]
                    or peer["language"] != target["language"]
                ):
                    continue

                # Same eligibility rule as the experimental live box.
                last_report = peer["release"] + dt.timedelta(
                    days=peer["last"] - 1 + 30
                )

                if last_report > as_of:
                    continue

                if not all(
                    day in peer["rows"]
                    for day in range(1, forecast_day + 1)
                ):
                    continue

                comparable_total = sum(
                    peer["rows"][day]
                    for day in range(1, forecast_day + 1)
                )

                if (
                    comparable_total <= 0
                    or peer["total"] < comparable_total
                ):
                    continue

                distance = (
                    abs(math.log(peer["week"] / target["week"]))
                    + abs(math.log(peer["hold"] / target["hold"]))
                )
                if (
                    forecast_day >= 14
                    and os.environ.get("FORECAST_USE_WEEK_HOLD") == "1"
                ):
                    target_recent = sum(
                        target["rows"][day]
                        for day in range(forecast_day - 6, forecast_day + 1)
                    )

                    target_previous = sum(
                        target["rows"][day]
                        for day in range(forecast_day - 13, forecast_day - 6)
                    )

                    peer_recent = sum(
                        peer["rows"][day]
                        for day in range(forecast_day - 6, forecast_day + 1)
                    )

                    peer_previous = sum(
                        peer["rows"][day]
                        for day in range(forecast_day - 13, forecast_day - 6)
                    )

                    if min(
                        target_recent,
                        target_previous,
                        peer_recent,
                        peer_previous,
                    ) > 0:
                        target_hold = target_recent / target_previous
                        peer_hold = peer_recent / peer_previous

                        distance += abs(
                            math.log(peer_hold / target_hold)
                        )

                estimate = max(
                    banked,
                    banked * peer["total"] / comparable_total,
                )

                peers.append((distance, peer, estimate))

            peers.sort(key=lambda item: item[0])
            peers = peers[:3]

            if len(peers) < 3:
                continue

            estimate = statistics.median(item[2] for item in peers)

            error = (
                abs(estimate - target["total"])
                / target["total"]
                * 100
            )

            errors.append(error)
            by_language.setdefault(target["language"], []).append(error)

            estimates = [item[2] for item in peers]

            if min(estimates) <= target["total"] <= max(estimates):
                covered += 1

            print(
                "{}: forecast ₹{:.2f} Cr; reference ₹{:.2f} Cr; "
                "error {:.1f}%; peers {}".format(
                    target["title"],
                    estimate,
                    target["total"],
                    error,
                    ", ".join(item[1]["title"] for item in peers),
                )
            )

        if errors:
            print(
                "Results: {} films; median error {:.1f}%".format(
                    len(errors),
                    statistics.median(errors),
                )
            )

            print(
                "Range contained reference: {}/{} films".format(
                    covered,
                    len(errors),
                )
            )

            for language, values in sorted(by_language.items()):
                print(
                    "  {}: {} films; median error {:.1f}%".format(
                        language.title(),
                        len(values),
                        statistics.median(values),
                    )
                )
        else:
            print("Not enough eligible historical films.")

    print(
        "\nRetrospective experiment: current source data can include "
        "later revisions; early reports may have changed and film runs "
        "may be incomplete. No calibrated probabilities."
    )


if __name__ == "__main__":
    main()
