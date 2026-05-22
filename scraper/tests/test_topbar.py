"""
Tests for parse_topbar() against both the real (2025+) sacnilk HTML structure
and edge cases.  The real structure uses:
  - <div class="movie-card ..."> for each film
  - <div class="font-bold"> for the title (desktop layout)
  - <div class="text-center font-bold text-green-600"> for Net collection
  - <a href="/movie/Title_Title_Year"> for the slug hint
  - Crore format: ₹22.10Cr (no space between number and Cr)
"""

import pytest
from bs4 import BeautifulSoup

from sacnilk_scraper import parse_topbar, parse_crore


class TestParseTopbarRealStructure:

    def test_extracts_three_films(self, topbar_real_html):
        soup = BeautifulSoup(topbar_real_html, "html.parser")
        films = parse_topbar(soup)
        assert len(films) == 3

    def test_film_keys_present(self, topbar_real_html):
        soup = BeautifulSoup(topbar_real_html, "html.parser")
        for f in parse_topbar(soup):
            assert "title" in f
            assert "gross" in f
            assert "slug_hint" in f

    def test_first_film_title(self, topbar_real_html):
        soup = BeautifulSoup(topbar_real_html, "html.parser")
        films = parse_topbar(soup)
        titles = [f["title"] for f in films]
        assert any("Bhoot Bhangla" in t for t in titles)

    def test_gross_values_parsed(self, topbar_real_html):
        soup = BeautifulSoup(topbar_real_html, "html.parser")
        films = parse_topbar(soup)
        grosses = [f["gross"] for f in films]
        assert any(abs(g - 22.10) < 0.01 for g in grosses)
        assert any(abs(g - 18.50) < 0.01 for g in grosses)
        assert any(abs(g - 2.90) < 0.01 for g in grosses)

    def test_slug_hints_use_new_movie_path(self, topbar_real_html):
        soup = BeautifulSoup(topbar_real_html, "html.parser")
        films = parse_topbar(soup)
        for f in films:
            # Slug hint should come from /movie/... href
            if f["slug_hint"]:
                assert "_" in f["slug_hint"] or f["slug_hint"].isalpha()

    def test_bhoot_bhangla_slug_hint(self, topbar_real_html):
        soup = BeautifulSoup(topbar_real_html, "html.parser")
        films = parse_topbar(soup)
        bhoot = next((f for f in films if "Bhoot" in f["title"]), None)
        assert bhoot is not None
        assert "Bhoot_Bhangla_2025" in bhoot["slug_hint"]

    def test_empty_page_returns_empty_list(self, no_data_html):
        soup = BeautifulSoup(no_data_html, "html.parser")
        assert parse_topbar(soup) == []

    def test_no_movie_cards_returns_empty(self):
        html = "<html><body><p>No films listed today.</p></body></html>"
        soup = BeautifulSoup(html, "html.parser")
        assert parse_topbar(soup) == []

    def test_film_without_green_div_is_skipped(self):
        """A movie-card with no identifiable Net figure should be excluded."""
        html = """
        <html><body>
        <div class="movie-card">
          <div class="font-bold">Mystery Film</div>
          <!-- no green-600 div -->
        </div>
        </body></html>
        """
        soup = BeautifulSoup(html, "html.parser")
        films = parse_topbar(soup)
        assert films == []


class TestParseCroreRealFormats:
    """
    The 2025+ sacnilk pages use formats like ₹22.10Cr (no space) and ₹ 2.9Cr
    (space after rupee symbol).  Verify parse_crore() handles all of them.
    """

    def test_rupee_no_space_before_cr(self):
        assert parse_crore("₹22.10Cr") == pytest.approx(22.10)

    def test_rupee_space_after_symbol(self):
        assert parse_crore("₹ 2.9Cr") == pytest.approx(2.9)

    def test_rupee_full_crore_suffix(self):
        assert parse_crore("₹3.39Crore") == pytest.approx(3.39)

    def test_lowercase_cr(self):
        assert parse_crore("₹18.50cr") == pytest.approx(18.50)

    def test_plain_decimal_no_symbol(self):
        assert parse_crore("18.50") == pytest.approx(18.50)

    def test_with_spaces_both_sides(self):
        assert parse_crore("  ₹ 15.2 Cr  ") == pytest.approx(15.2)

    def test_zero_value(self):
        assert parse_crore("₹0.00Cr") == pytest.approx(0.0)

    def test_integer_crore(self):
        assert parse_crore("₹42Cr") == pytest.approx(42.0)

    def test_large_rupee_amount_converts_to_crore(self):
        # ₹2,90,00,000 = 2.9 Cr
        result = parse_crore("₹2,90,00,000")
        assert result == pytest.approx(2.9, abs=0.01)

    def test_empty_string_returns_none(self):
        assert parse_crore("") is None

    def test_non_numeric_returns_none(self):
        assert parse_crore("N/A") is None

    def test_dash_returns_none(self):
        assert parse_crore("-") is None
