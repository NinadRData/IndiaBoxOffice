"""
sacnilk_scraper.py
------------------
Scrapes daily India nett box office data from sacnilk.com.

Sacnilk migrated its URL scheme in 2025:
  Old (410 Gone):  /BhootBhangla-2025/
  New (200 OK):    /movie/Bhoot_Bhangla_2025

Daily collection data is no longer in an HTML table; it lives in two places:
  1. Inline JS chart arrays: const netData = [...]; const labels = [...]
  2. #collection-cards-2 div: <a class="collection-card" data-day="N">

Both sources are tried in order.  The old table/div parsers are kept as a
last-resort fallback for any archived pages still served.

Usage:
    python sacnilk_scraper.py "Bhoot Bhangla"
    python sacnilk_scraper.py "Dhurandhar 2" --year 2026
    python sacnilk_scraper.py "Bhoot Bhangla" --json
    python sacnilk_scraper.py "Bhoot Bhangla" --output scraper/output/
    python sacnilk_scraper.py --topbar
    python sacnilk_scraper.py --topbar --output scraper/output/

Dependencies:
    pip install requests beautifulsoup4
"""

import json
import os
import re
import sys
import argparse
from datetime import datetime
from pathlib import Path

try:
    import requests
    import urllib3
    from bs4 import BeautifulSoup
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except ImportError:
    print("Missing dependencies. Run:  pip install requests beautifulsoup4")
    sys.exit(1)


BASE_URL = "https://sacnilk.com"
TOPBAR_URL = f"{BASE_URL}/entertainmenttopbar/Box_Office_Collection?hl=en"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://sacnilk.com/",
}


# ── URL / slug generation ─────────────────────────────────────────────────────

def make_movie_slug(title: str, year: int) -> str:
    """
    Build the primary sacnilk /movie/{slug} identifier.
    Sacnilk uses Title_Case_With_Underscores appended with _Year.
    e.g.  "Bhoot Bhangla" 2025  →  Bhoot_Bhangla_2025
    """
    words = re.sub(r"[^a-zA-Z0-9 ]", "", title).split()
    return "_".join(w.capitalize() for w in words) + f"_{year}"


def make_slugs(title: str, year: int) -> list[str]:
    """
    Generate all candidate URL slugs from a film title + year.
    Ordered from most-likely to least-likely based on observed sacnilk patterns.
    """
    words = re.sub(r"[^a-zA-Z0-9 ]", "", title).split()

    # New format (primary): Title_Case_Underscores_Year
    underscore_title = "_".join(w.capitalize() for w in words)
    underscore_lower = "_".join(w.lower() for w in words)

    # Legacy formats (may still work for older archived pages)
    joined = "".join(w.capitalize() for w in words)
    hyphen = "-".join(w.capitalize() for w in words)
    hyphen_lower = "-".join(w.lower() for w in words)

    yr = str(year)
    return [
        f"{underscore_title}_{yr}",       # Bhoot_Bhangla_2025   ← new primary
        f"{underscore_lower}_{yr}",        # bhoot_bhangla_2025   ← new lowercase
        f"{joined}-{yr}",                  # BhootBhangla-2025    ← old primary
        f"{hyphen}-{yr}",                  # Bhoot-Bhangla-2025   ← old hyphen
        f"{hyphen_lower}-{yr}",            # bhoot-bhangla-2025   ← old lc hyphen
        f"{underscore_title}",             # Bhoot_Bhangla        ← no year
        f"{joined}",                       # BhootBhangla
        f"{hyphen}",                       # Bhoot-Bhangla
    ]


# ── HTTP fetching ─────────────────────────────────────────────────────────────

def fetch_page(slug: str, session: requests.Session | None = None) -> requests.Response | None:
    """
    Try to fetch a sacnilk film page for the given slug.
    Tries the new /movie/ path first, then legacy paths.
    """
    get = session.get if session is not None else requests.get
    urls = [
        f"{BASE_URL}/movie/{slug}",           # new format (primary)
        f"{BASE_URL}/{slug}/",                 # legacy
        f"{BASE_URL}/collection/{slug}/",      # legacy
        f"{BASE_URL}/box-office/{slug}/",      # legacy
    ]
    for url in urls:
        try:
            # verify=False: sacnilk.com uses a cert not in standard CA bundles
            r = get(url, headers=HEADERS, timeout=10, verify=False)
            if r.status_code == 200 and "sacnilk" in r.url:
                return r
        except requests.RequestException:
            continue
    return None


def fetch_topbar(session: requests.Session | None = None) -> requests.Response | None:
    """Fetch the sacnilk box office topbar overview page."""
    get = session.get if session is not None else requests.get
    try:
        r = get(TOPBAR_URL, headers=HEADERS, timeout=10, verify=False)
        if r.status_code == 200:
            return r
    except requests.RequestException:
        pass
    return None


# ── Parsing: daily collection data ───────────────────────────────────────────

def parse_chart_data(soup: BeautifulSoup) -> list[dict]:
    """
    Extract day-by-day collection from the inline Chart.js data arrays:
      const labels   = ["Day 1", "Day 2", ...];
      const netData  = [2.9, 3.5, ...];
      const grossData = [3.393, 4.1, ...];

    This is the primary parser for the current sacnilk layout (2025+).
    """
    labels_data: list[str] = []
    net_data: list[float] = []
    gross_data: list[float] = []

    for script in soup.find_all("script"):
        text = script.string or ""
        if "netData" not in text:
            continue

        m_labels = re.search(r"const\s+labels\s*=\s*(\[.*?\]);", text, re.DOTALL)
        m_net    = re.search(r"const\s+netData\s*=\s*(\[.*?\]);",  text, re.DOTALL)
        m_gross  = re.search(r"const\s+grossData\s*=\s*(\[.*?\]);", text, re.DOTALL)

        if m_net:
            try:
                net_data = json.loads(m_net.group(1))
            except (json.JSONDecodeError, ValueError):
                continue
        if m_labels:
            try:
                labels_data = json.loads(m_labels.group(1))
            except (json.JSONDecodeError, ValueError):
                pass
        if m_gross:
            try:
                gross_data = json.loads(m_gross.group(1))
            except (json.JSONDecodeError, ValueError):
                pass

        if net_data:
            break  # found the chart script — stop scanning

    if not net_data:
        return []

    rows = []
    running = 0.0
    prev_gross = None

    for i, gross in enumerate(net_data):
        running = round(running + gross, 2)

        label = labels_data[i] if i < len(labels_data) else f"Day {i + 1}"
        total = running  # gross_data total would differ; use running net for consistency

        chg_day = None
        if prev_gross is not None and prev_gross > 0:
            chg_day = round((gross / prev_gross - 1) * 100, 1)

        rows.append({
            "date":    label,
            "day":     label,
            "gross":   round(float(gross), 2),
            "total":   total,
            "chg_day": chg_day,
        })
        prev_gross = gross

    return rows


def parse_collection_cards(soup: BeautifulSoup) -> list[dict]:
    """
    Extract day-by-day collection from the #collection-cards-2 div.
    Each card is an <a class="collection-card" data-day="N"> element
    containing a text node like "₹ 2.9Cr".

    Used as a secondary parser when chart data is unavailable.
    """
    container = soup.find(id="collection-cards-2")
    if not container:
        return []

    cards = container.find_all("a", class_="collection-card")
    if not cards:
        return []

    rows = []
    running = 0.0
    prev_gross = None

    for card in cards:
        day_num = card.get("data-day", "")
        label = f"Day {day_num}" if day_num else ""
        text = card.get_text(" ", strip=True)

        # Anchor on ₹ to avoid day-label digits ("Day 1") concatenating with
        # the collection figure when whitespace is stripped.
        m = re.search(r"₹\s*(\d+(?:\.\d+)?)\s*(?:Cr|crore)", text, re.I)
        if not m:
            continue
        gross = float(m.group(1))

        running = round(running + gross, 2)

        chg_day = None
        if prev_gross is not None and prev_gross > 0:
            chg_day = round((gross / prev_gross - 1) * 100, 1)

        rows.append({
            "date":    label,
            "day":     label,
            "gross":   gross,
            "total":   running,
            "chg_day": chg_day,
        })
        prev_gross = gross

    return rows


def parse_daily_table(soup: BeautifulSoup) -> list[dict]:
    """
    Parse day-by-day India nett data. Tries sources in priority order:
      1. Inline JS chart arrays (current sacnilk layout)
      2. #collection-cards-2 div (secondary sacnilk layout)
      3. HTML <table> with India/Nett header (legacy layout)
      4. div-based layout (legacy fallback)
    """
    # 1. Chart JS arrays (primary — new layout)
    rows = parse_chart_data(soup)
    if rows:
        return rows

    # 2. Collection-cards div (secondary — new layout)
    rows = parse_collection_cards(soup)
    if rows:
        return rows

    # 3. HTML table (legacy)
    rows = _parse_html_table(soup)
    if rows:
        return rows

    # 4. Div fallback (legacy)
    return parse_div_layout(soup)


def _parse_html_table(soup: BeautifulSoup) -> list[dict]:
    """Parse the India Nett HTML table (legacy sacnilk layout, pre-2025)."""
    rows = []
    target_table = None
    for t in soup.find_all("table"):
        headers = [th.get_text(strip=True).lower() for th in t.find_all("th")]
        if any("india" in h or "nett" in h or "net" in h for h in headers):
            target_table = t
            break

    if not target_table:
        return []

    headers = [th.get_text(strip=True).lower() for th in target_table.find_all("th")]
    col_date  = next((i for i, h in enumerate(headers) if "date" in h), None)
    col_day   = next((i for i, h in enumerate(headers) if h in ("day", "weekday")), None)
    col_india = next((i for i, h in enumerate(headers) if "india" in h or "nett" in h or "net" in h), None)
    col_total = next((i for i, h in enumerate(headers) if "total" in h or "running" in h), None)

    if col_india is None:
        print("⚠  Could not identify India Nett column. Headers found:", headers)
        return []

    running = 0.0
    prev_gross = None

    for tr in target_table.find_all("tr")[1:]:
        cells = tr.find_all(["td", "th"])
        if len(cells) < 2:
            continue

        def cell(i, _cells=cells):
            return _cells[i].get_text(strip=True) if i is not None and i < len(_cells) else ""

        gross = parse_crore(cell(col_india))
        if gross is None:
            continue

        running = round(running + gross, 2)
        total_str = cell(col_total) if col_total is not None else ""
        total = parse_crore(total_str) if total_str else running

        chg_day = None
        if prev_gross is not None and prev_gross > 0:
            chg_day = round((gross / prev_gross - 1) * 100, 1)

        rows.append({
            "date":    cell(col_date) if col_date is not None else "",
            "day":     cell(col_day)  if col_day  is not None else "",
            "gross":   gross,
            "total":   total if total else running,
            "chg_day": chg_day,
        })
        prev_gross = gross

    return rows


def parse_div_layout(soup: BeautifulSoup) -> list[dict]:
    """Legacy fallback: card/div layout with class containing 'day' or 'collect'."""
    rows = []
    day_blocks = soup.find_all("div", class_=re.compile(r"day|collect|box-office", re.I))

    running = 0.0
    prev_gross = None

    for block in day_blocks:
        text = block.get_text(" ", strip=True)
        m = re.search(r"(\d+(?:\.\d+)?)\s*(?:Cr|cr|crore)", text, re.I)
        if not m:
            continue
        gross = float(m.group(1))
        running = round(running + gross, 2)

        date_m = re.search(r"(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[\s,]+(\w+\s+\d+)", text, re.I)
        date_str = date_m.group(0) if date_m else ""
        day_str  = date_m.group(1)[:3].capitalize() if date_m else ""

        chg_day = None
        if prev_gross and prev_gross > 0:
            chg_day = round((gross / prev_gross - 1) * 100, 1)

        rows.append({
            "date":    date_str,
            "day":     day_str,
            "gross":   gross,
            "total":   running,
            "chg_day": chg_day,
        })
        prev_gross = gross

    return rows


# ── Parsing: topbar overview ──────────────────────────────────────────────────

def parse_topbar(soup: BeautifulSoup) -> list[dict]:
    """
    Parse the sacnilk box office topbar overview.
    HTML structure (2025+ layout):
      <div class="movie-card ...">
        <div class="font-bold">Film Title</div>       ← title (desktop)
        <div class="text-center font-bold text-green-600">₹2.90Cr</div>  ← Net
        <a href="/movie/Film_Title_Year">              ← slug hint
      </div>

    Returns list of {title, gross, slug_hint}.
    """
    films = []

    for card in soup.find_all("div", class_=re.compile(r"\bmovie-card\b")):
        # Title: prefer the desktop <div class="font-bold"> or <h3>
        title_el = card.find(["h3", "h2"], class_=re.compile(r"font-bold", re.I))
        if not title_el:
            title_el = card.find("div", class_=re.compile(r"^font-bold$", re.I))
        if not title_el:
            # Fallback: any element with film-title-like class
            title_el = card.find(
                ["a", "h2", "h3", "h4", "strong", "span"],
                class_=re.compile(r"title|name|film|movie", re.I),
            )
        title = title_el.get_text(strip=True) if title_el else ""

        # Net collection: first green-600 bold div
        net_el = card.find("div", class_=re.compile(r"text-green-600", re.I))
        gross_text = net_el.get_text(strip=True) if net_el else ""
        gross = parse_crore(gross_text)
        if gross is None:
            continue

        # Slug hint from link
        link_tag = card.find("a", href=re.compile(r"^/movie/"))
        slug_hint = ""
        if link_tag:
            slug_hint = link_tag["href"].lstrip("/movie/").split("/")[0]

        if title:
            films.append({"title": title, "gross": gross, "slug_hint": slug_hint})

    return films


# ── Numeric helpers ───────────────────────────────────────────────────────────

def parse_crore(text: str) -> float | None:
    """
    Extract a numeric crore value from strings in various formats:
      "3.75 Cr"  "₹3.75Cr"  "₹ 2.9Cr"  "₹3,75,00,000"  "18.5"
    """
    if not text:
        return None
    cleaned = re.sub(r"[₹,\s]", "", text)
    # Strip trailing 'Cr' or 'crore' before numeric search
    cleaned = re.sub(r"(?i)(crore|cr)$", "", cleaned)
    m = re.search(r"(\d+(?:\.\d+)?)", cleaned)
    if not m:
        return None
    val = float(m.group(1))
    if val > 10000:
        val = round(val / 1e7, 2)
    return val


# ── Output helpers ────────────────────────────────────────────────────────────

def format_for_tracker(rows: list[dict], title: str) -> str:
    """Format scraped rows as JS daily array entries for copy-paste into the tracker."""
    lines = [f"  // -- {title} | scraped {datetime.now().strftime('%Y-%m-%d %H:%M')} --"]
    for r in rows:
        chg_day = f"{r['chg_day']:+.1f}" if r["chg_day"] is not None else "null"
        lines.append(
            f"  {{date:'{r['date']}', day:'{r['day']}', "
            f"gross:{r['gross']}, chgDay:{chg_day}, chgWeek:null, total:{r['total']}}},"
        )
    return "\n".join(lines)


def summarise(rows: list[dict], title: str):
    """Print a human-readable summary."""
    if not rows:
        print("No rows parsed.")
        return
    total = rows[-1]["total"]
    latest = rows[-1]
    print(f"\n{'-'*55}")
    print(f"  {title}")
    print(f"{'-'*55}")
    print(f"  Days tracked   : {len(rows)}")
    print(f"  Running total  : Rs.{total} Cr")
    print(f"  Latest day     : {latest['date']} ({latest['day']}) - Rs.{latest['gross']} Cr")
    if latest["chg_day"] is not None:
        arrow = "+" if latest["chg_day"] >= 0 else "-"
        print(f"  Day-on-day     : {arrow} {abs(latest['chg_day']):.1f}%")
    print(f"{'-'*55}\n")


def write_output(rows: list[dict], slug: str, output_dir: str) -> str:
    """Write rows as JSON to output_dir/{slug}.json. Returns the written path."""
    out_path = Path(output_dir) / f"{slug}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)
    return str(out_path)


def scrape_film(title: str, year: int, session: requests.Session | None = None) -> tuple[list[dict], str | None]:
    """
    Scrape a single film. Returns (rows, used_slug) or ([], None) on failure.
    Extracted from main() to allow programmatic use and unit testing.
    """
    slugs = make_slugs(title, year)
    for slug in slugs:
        response = fetch_page(slug, session=session)
        if response:
            soup = BeautifulSoup(response.text, "html.parser")
            rows = parse_daily_table(soup)
            if rows:
                return rows, slug
    return [], None


# ── Main ──────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scrape sacnilk box office data")
    parser.add_argument("title", nargs="?", help="Film title e.g. 'Bhoot Bhangla'")
    parser.add_argument("--year", type=int, default=datetime.now().year,
                        help="Release year (default: current year)")
    parser.add_argument("--json", action="store_true", help="Output raw JSON only")
    parser.add_argument("--js",   action="store_true", help="Output JS array snippet")
    parser.add_argument("--topbar", action="store_true",
                        help="Fetch and display the box office overview topbar")
    parser.add_argument("--output", metavar="DIR",
                        default=os.environ.get("SCRAPER_OUTPUT_DIR"),
                        help="Directory to write {slug}.json output files")
    parser.add_argument("--output-slug", metavar="SLUG",
                        help="Override the output filename (default: inferred from URL slug)")
    args = parser.parse_args(argv)

    if args.topbar:
        print("Fetching sacnilk box office topbar ...")
        resp = fetch_topbar()
        if not resp:
            print("Could not fetch topbar.")
            return 1
        soup = BeautifulSoup(resp.text, "html.parser")
        films = parse_topbar(soup)
        if not films:
            print("Topbar fetched but no film data could be parsed.")
            return 1
        if args.output:
            out_path = write_output(films, "topbar", args.output)
            print(f"Topbar data written to {out_path}")
        if args.json:
            print(json.dumps(films, indent=2))
        else:
            print(f"\n{'-'*55}")
            print(f"  Current Box Office ({len(films)} films)")
            print(f"{'-'*55}")
            for f in films:
                print(f"  {f['title']:<35} Rs.{f['gross']} Cr")
            print(f"{'-'*55}\n")
        return 0

    if not args.title:
        parser.error("title is required unless --topbar is used")

    title = args.title
    year  = args.year
    slugs = make_slugs(title, year)

    print(f"Searching sacnilk for: {title} ({year})")

    response = None
    used_slug = None
    for slug in slugs:
        print(f"  Trying slug={slug!r} ...", end=" ", flush=True)
        response = fetch_page(slug)
        if response:
            print("ok")
            used_slug = slug
            break
        print("not found")

    if not response:
        print(f"\nCould not find '{title}' on sacnilk.")
        print("Try adjusting the title or check the URL manually at sacnilk.com")
        return 1

    print(f"\nFound page: {response.url}")
    soup = BeautifulSoup(response.text, "html.parser")
    rows = parse_daily_table(soup)

    if not rows:
        print("Page found but no collection data could be parsed.")
        print("Sacnilk may have changed their layout. Saving raw HTML to sacnilk_debug.html")
        with open("sacnilk_debug.html", "w", encoding="utf-8") as f:
            f.write(response.text)
        return 1

    if args.output:
        output_slug = args.output_slug if args.output_slug else used_slug
        out_path = write_output(rows, output_slug, args.output)
        print(f"Data written to {out_path}")

    if args.json:
        print(json.dumps(rows, indent=2))
        return 0

    if args.js:
        print(format_for_tracker(rows, title))
        return 0

    summarise(rows, title)
    print("-- JS snippet (paste into daily array) --\n")
    print(format_for_tracker(rows, title))
    return 0


if __name__ == "__main__":
    sys.exit(main())
