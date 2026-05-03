"""
sacnilk_scraper.py
------------------
Scrapes daily India nett box office data from sacnilk.com
for a given film and prints JSON-ready output for the live tracker.

Usage:
    python sacnilk_scraper.py "Bhoot Bhangla"
    python sacnilk_scraper.py "Dhurandhar 2" --year 2026
    python sacnilk_scraper.py "Bhoot Bhangla" --json   # raw JSON only

Dependencies:
    pip install requests beautifulsoup4
"""

import sys
import re
import json
import argparse
from datetime import datetime

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Missing dependencies. Run:  pip install requests beautifulsoup4")
    sys.exit(1)


# ── Sacnilk URL patterns to try ──────────────────────────────────────────────
# Sacnilk uses slugs like:
#   /BhootBhangla-2025/  or  /Bhoot-Bhangla-2025/
# We try several variants automatically.

BASE_URL = "https://sacnilk.com"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://sacnilk.com/",
}


def make_slugs(title: str, year: int) -> list[str]:
    """Generate candidate URL slugs from a film title + year."""
    # Remove special chars, title-case each word
    words = re.sub(r"[^a-zA-Z0-9 ]", "", title).split()
    
    # Variant 1: no spaces  e.g. BhootBhangla
    joined = "".join(w.capitalize() for w in words)
    # Variant 2: hyphenated  e.g. Bhoot-Bhangla
    hyphen = "-".join(w.capitalize() for w in words)
    # Variant 3: lowercase hyphen
    hyphen_lower = "-".join(w.lower() for w in words)

    yr = str(year)
    slugs = [
        f"{joined}-{yr}",
        f"{hyphen}-{yr}",
        f"{hyphen_lower}-{yr}",
        f"{joined}",          # without year
        f"{hyphen}",
    ]
    return slugs


def fetch_page(slug: str) -> requests.Response | None:
    """Try to fetch a sacnilk collection page for the given slug."""
    urls = [
        f"{BASE_URL}/{slug}/",
        f"{BASE_URL}/collection/{slug}/",
        f"{BASE_URL}/box-office/{slug}/",
    ]
    for url in urls:
        try:
            r = requests.get(url, headers=HEADERS, timeout=10)
            if r.status_code == 200 and "sacnilk" in r.url:
                return r
        except requests.RequestException:
            continue
    return None


def parse_daily_table(soup: BeautifulSoup) -> list[dict]:
    """
    Parse the day-by-day India nett table from sacnilk HTML.
    Returns a list of dicts with keys: date, day, gross, total, chg_day_pct
    """
    rows = []

    # Sacnilk typically has a <table> with rows like:
    #   Day | Date | India Nett | Total
    # Column positions can vary — we detect by header text.
    tables = soup.find_all("table")
    
    target_table = None
    for t in tables:
        headers = [th.get_text(strip=True).lower() for th in t.find_all("th")]
        if any("india" in h or "nett" in h or "net" in h for h in headers):
            target_table = t
            break

    if not target_table:
        # Fallback: look for div-based layout sacnilk sometimes uses
        return parse_div_layout(soup)

    headers = [th.get_text(strip=True).lower() for th in target_table.find_all("th")]
    
    # Detect column indices
    col_date  = next((i for i, h in enumerate(headers) if "date" in h), None)
    col_day   = next((i for i, h in enumerate(headers) if h in ("day", "weekday")), None)
    col_india = next((i for i, h in enumerate(headers) if "india" in h or "nett" in h or "net" in h), None)
    col_total = next((i for i, h in enumerate(headers) if "total" in h or "running" in h), None)

    if col_india is None:
        print("⚠  Could not identify India Nett column. Headers found:", headers)
        return []

    running = 0.0
    prev_gross = None

    for tr in target_table.find_all("tr")[1:]:  # skip header row
        cells = tr.find_all(["td", "th"])
        if len(cells) < 2:
            continue

        def cell(i):
            return cells[i].get_text(strip=True) if i is not None and i < len(cells) else ""

        raw_india = cell(col_india)
        gross = parse_crore(raw_india)
        if gross is None:
            continue

        running = round(running + gross, 2)

        date_str = cell(col_date) if col_date is not None else ""
        day_str  = cell(col_day)  if col_day  is not None else ""
        total_str = cell(col_total) if col_total is not None else ""
        total = parse_crore(total_str) if total_str else running

        chg_day = None
        if prev_gross is not None and prev_gross > 0:
            chg_day = round((gross / prev_gross - 1) * 100, 1)

        rows.append({
            "date":    date_str,
            "day":     day_str,
            "gross":   gross,
            "total":   total if total else running,
            "chg_day": chg_day,
        })
        prev_gross = gross

    return rows


def parse_div_layout(soup: BeautifulSoup) -> list[dict]:
    """
    Fallback parser for sacnilk's card/div based layouts.
    Looks for repeated patterns of date + collection figures.
    """
    rows = []
    # Sacnilk sometimes uses divs with class containing 'day' or 'collection'
    day_blocks = soup.find_all("div", class_=re.compile(r"day|collect|box-office", re.I))
    
    running = 0.0
    prev_gross = None

    for block in day_blocks:
        text = block.get_text(" ", strip=True)
        # Look for a crore figure
        m = re.search(r"(\d+(?:\.\d+)?)\s*(?:Cr|cr|crore)", text, re.I)
        if not m:
            continue
        gross = float(m.group(1))
        running = round(running + gross, 2)

        # Try to extract date
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


def parse_crore(text: str) -> float | None:
    """Extract a numeric crore value from a string like '3.75 Cr' or '₹3,75,000'."""
    if not text:
        return None
    # Remove currency symbols and commas
    cleaned = re.sub(r"[₹,\s]", "", text)
    # Match decimal number optionally followed by Cr/crore
    m = re.search(r"(\d+(?:\.\d+)?)", cleaned)
    if not m:
        return None
    val = float(m.group(1))
    # If the value looks like full rupees (> 10000), convert to crore
    if val > 10000:
        val = round(val / 1e7, 2)
    return val


def format_for_tracker(rows: list[dict], title: str) -> str:
    """Format scraped rows as JS daily array entries for copy-paste into the tracker."""
    lines = [f"  // ── {title} · scraped {datetime.now().strftime('%Y-%m-%d %H:%M')} ──"]
    for r in rows:
        chg_day  = f"{r['chg_day']:+.1f}"  if r["chg_day"]  is not None else "null"
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
    print(f"\n{'─'*55}")
    print(f"  {title}")
    print(f"{'─'*55}")
    print(f"  Days tracked   : {len(rows)}")
    print(f"  Running total  : ₹{total} Cr")
    print(f"  Latest day     : {latest['date']} ({latest['day']}) — ₹{latest['gross']} Cr")
    if latest["chg_day"] is not None:
        arrow = "▲" if latest["chg_day"] >= 0 else "▼"
        print(f"  Day-on-day     : {arrow} {latest['chg_day']:+.1f}%")
    print(f"{'─'*55}\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Scrape sacnilk box office data")
    parser.add_argument("title", help="Film title e.g. 'Bhoot Bhangla'")
    parser.add_argument("--year", type=int, default=datetime.now().year,
                        help="Release year (default: current year)")
    parser.add_argument("--json", action="store_true",
                        help="Output raw JSON only")
    parser.add_argument("--js",   action="store_true",
                        help="Output JS array snippet for copy-paste into tracker")
    args = parser.parse_args()

    title = args.title
    year  = args.year
    slugs = make_slugs(title, year)

    print(f"🔍 Searching sacnilk for: {title} ({year})")
    
    response = None
    used_slug = None
    for slug in slugs:
        print(f"   Trying /{slug}/ ...", end=" ", flush=True)
        response = fetch_page(slug)
        if response:
            print("✓")
            used_slug = slug
            break
        print("✗")

    if not response:
        print(f"\n❌  Could not find '{title}' on sacnilk.")
        print("    Try adjusting the title or check the URL manually at sacnilk.com")
        sys.exit(1)

    print(f"\n✅  Found page: {response.url}")
    soup = BeautifulSoup(response.text, "html.parser")

    rows = parse_daily_table(soup)

    if not rows:
        print("⚠  Page found but no collection data could be parsed.")
        print("   Sacnilk may have changed their layout. Saving raw HTML to sacnilk_debug.html")
        with open("sacnilk_debug.html", "w", encoding="utf-8") as f:
            f.write(response.text)
        sys.exit(1)

    if args.json:
        print(json.dumps(rows, indent=2))
        return

    if args.js:
        print(format_for_tracker(rows, title))
        return

    # Default: summary + JS snippet
    summarise(rows, title)
    print("── JS snippet (paste into daily array) ──\n")
    print(format_for_tracker(rows, title))


if __name__ == "__main__":
    main()
