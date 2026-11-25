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

        malayalam.films = []
        previous_labels.extend(preserve_industry("Malayalam"))
    # Import Kannada industry records without replacing existing totals.
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

            if film["year"] <= 2024 and film["url"] not in known_urls:
                parser.films.append(film)
                known_urls.add(film["url"])

        print("Kannada reference records found:", len(kannada.films))

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
