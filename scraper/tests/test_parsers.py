"""Tests for parse_crore, parse_daily_table, parse_div_layout, parse_topbar."""

import pytest
from bs4 import BeautifulSoup

from sacnilk_scraper import (
    parse_crore,
    parse_daily_table,
    parse_div_layout,
    parse_topbar,
)


# ── parse_crore ───────────────────────────────────────────────────────────────

class TestParseCrore:
    def test_decimal_cr(self):
        assert parse_crore("3.75 Cr") == 3.75

    def test_integer_cr(self):
        assert parse_crore("15 Cr") == 15.0

    def test_crore_lowercase(self):
        assert parse_crore("8.5 crore") == 8.5

    def test_rupee_symbol_large(self):
        # ₹3,75,00,000 = 3.75 Cr
        assert parse_crore("₹3,75,00,000") == 3.75

    def test_comma_separated_large(self):
        # 1,82,50,000 = 1.825 Cr
        result = parse_crore("1,82,50,000")
        assert result is not None
        assert result == pytest.approx(1.825, abs=0.01)

    def test_plain_number(self):
        assert parse_crore("18.5") == 18.5

    def test_empty_string_returns_none(self):
        assert parse_crore("") is None

    def test_none_like_text_returns_none(self):
        assert parse_crore("N/A") is None

    def test_zero(self):
        assert parse_crore("0 Cr") == 0.0

    def test_whitespace_around_value(self):
        assert parse_crore("  22.10 Cr  ") == 22.10


# ── parse_daily_table ─────────────────────────────────────────────────────────

class TestParseDailyTable:
    def test_happy_path_row_count(self, sample_table_html):
        soup = BeautifulSoup(sample_table_html, "html.parser")
        rows = parse_daily_table(soup)
        assert len(rows) == 5

    def test_first_row_values(self, sample_table_html):
        soup = BeautifulSoup(sample_table_html, "html.parser")
        rows = parse_daily_table(soup)
        first = rows[0]
        assert first["gross"] == pytest.approx(15.20)
        assert first["total"] == pytest.approx(15.20)
        assert first["chg_day"] is None   # day 1 has no prior day

    def test_second_row_chg_day(self, sample_table_html):
        soup = BeautifulSoup(sample_table_html, "html.parser")
        rows = parse_daily_table(soup)
        second = rows[1]
        assert second["gross"] == pytest.approx(12.50)
        expected_chg = round((12.50 / 15.20 - 1) * 100, 1)
        assert second["chg_day"] == pytest.approx(expected_chg, abs=0.1)

    def test_running_total_accumulates(self, sample_table_html):
        soup = BeautifulSoup(sample_table_html, "html.parser")
        rows = parse_daily_table(soup)
        # Computed total from table: 15.20 + 12.50 + 10.00 + 18.30 + 22.10 = 78.10
        assert rows[-1]["total"] == pytest.approx(78.10, abs=0.01)

    def test_required_keys_present(self, sample_table_html):
        soup = BeautifulSoup(sample_table_html, "html.parser")
        rows = parse_daily_table(soup)
        for row in rows:
            assert set(row.keys()) == {"date", "day", "gross", "total", "chg_day"}

    def test_date_string_populated(self, sample_table_html):
        soup = BeautifulSoup(sample_table_html, "html.parser")
        rows = parse_daily_table(soup)
        assert rows[0]["date"] == "Wed, Apr 16"

    def test_no_table_falls_back_to_div(self, sample_div_html):
        """HTML with no India Nett table should trigger the div fallback."""
        soup = BeautifulSoup(sample_div_html, "html.parser")
        rows = parse_daily_table(soup)
        # The div fixture has 3 entries with class 'collection-day'
        assert len(rows) == 3

    def test_empty_html_returns_empty(self, no_data_html):
        soup = BeautifulSoup(no_data_html, "html.parser")
        rows = parse_daily_table(soup)
        assert rows == []

    def test_chg_day_positive_on_increase(self, sample_table_html):
        soup = BeautifulSoup(sample_table_html, "html.parser")
        rows = parse_daily_table(soup)
        # Day 4 (18.30) > Day 3 (10.00) — should be positive
        assert rows[3]["chg_day"] > 0

    def test_chg_day_negative_on_decrease(self, sample_table_html):
        soup = BeautifulSoup(sample_table_html, "html.parser")
        rows = parse_daily_table(soup)
        # Day 2 (12.50) < Day 1 (15.20) — should be negative
        assert rows[1]["chg_day"] < 0


# ── parse_div_layout ──────────────────────────────────────────────────────────

class TestParseDivLayout:
    def test_extracts_three_rows(self, sample_div_html):
        soup = BeautifulSoup(sample_div_html, "html.parser")
        rows = parse_div_layout(soup)
        assert len(rows) == 3

    def test_first_row_gross(self, sample_div_html):
        soup = BeautifulSoup(sample_div_html, "html.parser")
        rows = parse_div_layout(soup)
        assert rows[0]["gross"] == pytest.approx(8.50)

    def test_running_total(self, sample_div_html):
        soup = BeautifulSoup(sample_div_html, "html.parser")
        rows = parse_div_layout(soup)
        assert rows[-1]["total"] == pytest.approx(8.50 + 6.20 + 5.10, abs=0.01)

    def test_chg_day_none_on_first(self, sample_div_html):
        soup = BeautifulSoup(sample_div_html, "html.parser")
        rows = parse_div_layout(soup)
        assert rows[0]["chg_day"] is None

    def test_no_div_blocks_returns_empty(self, no_data_html):
        soup = BeautifulSoup(no_data_html, "html.parser")
        rows = parse_div_layout(soup)
        assert rows == []


# ── parse_topbar ──────────────────────────────────────────────────────────────

class TestParseTopbar:
    def test_extracts_three_films(self, sample_topbar_html):
        soup = BeautifulSoup(sample_topbar_html, "html.parser")
        films = parse_topbar(soup)
        assert len(films) == 3

    def test_film_keys(self, sample_topbar_html):
        soup = BeautifulSoup(sample_topbar_html, "html.parser")
        films = parse_topbar(soup)
        for f in films:
            assert "title" in f
            assert "gross" in f
            assert "slug_hint" in f

    def test_gross_values(self, sample_topbar_html):
        soup = BeautifulSoup(sample_topbar_html, "html.parser")
        films = parse_topbar(soup)
        grosses = {f["gross"] for f in films}
        assert 22.10 in grosses
        assert 18.50 in grosses
        assert 9.75 in grosses

    def test_slug_hints_extracted(self, sample_topbar_html):
        soup = BeautifulSoup(sample_topbar_html, "html.parser")
        films = parse_topbar(soup)
        hints = {f["slug_hint"] for f in films}
        assert "BhootBhangla-2025" in hints

    def test_empty_page_returns_empty(self, no_data_html):
        soup = BeautifulSoup(no_data_html, "html.parser")
        films = parse_topbar(soup)
        assert films == []
