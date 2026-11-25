"""Retrospective day-7 India-net forecast comparison."""

import datetime as dt
import json
import math
import pathlib
import statistics

DATA = pathlib.Path(__file__).resolve().parent / "data"


def load(name):
    with (DATA / name).open(encoding="utf-8") as file:
        return json.load(file)


def main():
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
    }

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

        print(
            "\n{} · reported ₹{:.2f} Cr".format(
                target["title"],
                target["actual"],
            )
        )

        for name, group in methods.items():
            multipliers = [
                peer["actual"] / peer["week1"]
                for peer in group
            ]

            multiplier = statistics.median(multipliers)
            estimate = target["week1"] * multiplier
            error = abs(estimate - target["actual"]) / target["actual"] * 100

            errors[name].append(error)

            print(
                "  {}: ₹{:.2f} Cr · error {:.1f}% · peers: {}".format(
                    name,
                    estimate,
                    error,
                    ", ".join(peer["title"] for peer in group),
                )
            )

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

    print(
        "\nExperimental only: no language, actor, director or clash "
        "matching yet, and no calibrated probabilities."
    )


if __name__ == "__main__":
    main()
