"""Test a simple day-7 India-net forecast against historical films."""

import json
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"


def load(name):
    with (DATA / name).open(encoding="utf-8") as file:
        return json.load(file)


def main():
    historical = load("historical.json")
    snapshot = load("sacnilk.json")

    # Match records by their Sacnilk URL and release year.
    totals = {}

    for film in snapshot.get("films", []):
        url = film.get("url")
        year = film.get("year")
        total = film.get("indiaNet")

        if (
            isinstance(url, str)
            and isinstance(year, int)
            and isinstance(total, (int, float))
            and not isinstance(total, bool)
            and total > 0
        ):
            key = (url, year)

            # Skip ambiguous duplicate entries.
            if key in totals:
                totals[key] = None
            else:
                totals[key] = float(total)

    samples = []

    for film in historical.get("films", []):
        if not isinstance(film, dict):
            continue

        year = film.get("year")
        url = film.get("url")
        days = film.get("days")

        # Keep the test to post-2020 films.
        if not isinstance(year, int) or year < 2021:
            continue

        actual = totals.get((url, year))

        if actual is None or not isinstance(days, list):
            continue

        first_week = {}
        invalid = False

        for row in days:
            if not isinstance(row, dict):
                continue

            day = row.get("day")
            amount = row.get("indiaNet")

            if isinstance(day, int) and 1 <= day <= 7:
                if (
                    day in first_week
                    or not isinstance(amount, (int, float))
                    or isinstance(amount, bool)
                    or amount < 0
                ):
                    invalid = True
                    break

                first_week[day] = float(amount)

        if invalid or set(first_week) != set(range(1, 8)):
            continue

        week1 = sum(first_week.values())

        if week1 <= 0 or actual < week1:
            continue

        samples.append({
            "title": film.get("title", "Unknown"),
            "year": year,
            "week1": week1,
            "actual": actual,
            "multiplier": actual / week1,
        })

    print("\nDAY-7 INDIA-NET FORECAST TEST")
    print("Totals are the latest snapshot figures, not guaranteed final totals.")
    print("Each forecast uses the median multiplier from the other films.\n")

    if len(samples) < 4:
        print("Not enough matching films to run the test.")
        print("Usable films:", len(samples))
        return

    errors = []

    for sample in samples:
        peers = [
            other["multiplier"]
            for other in samples
            if other is not sample
        ]

        multiplier = statistics.median(peers)
        estimate = sample["week1"] * multiplier
        error = abs(estimate - sample["actual"]) / sample["actual"] * 100

        errors.append(error)

        print(
            f'{sample["title"]} ({sample["year"]}): '
            f'day 7 ₹{sample["week1"]:.2f} Cr | '
            f'forecast ₹{estimate:.2f} Cr | '
            f'reported ₹{sample["actual"]:.2f} Cr | '
            f'error {error:.1f}%'
        )

    print("\nFilms tested:", len(samples))
    print(f"Median absolute percentage error: {statistics.median(errors):.1f}%")
    print(f"Average absolute percentage error: {statistics.mean(errors):.1f}%")
    print(
        "\nThis is a pooled baseline. It does not yet account for "
        "language, scale, weekday holds, or whether a film's run is complete."
    )


if __name__ == "__main__":
    main()
