"""
Tests for parse_collection_cards() — the secondary parser for the current
sacnilk layout where daily data lives in #collection-cards-2 anchor elements.
"""

import pytest
from bs4 import BeautifulSoup

from sacnilk_scraper import parse_collection_cards, parse_daily_table


class TestParseCollectionCards:

    def test_extracts_correct_row_count(self, film_page_cards_only_html):
        soup = BeautifulSoup(film_page_cards_only_html, "html.parser")
        rows = parse_collection_cards(soup)
        assert len(rows) == 3

    def test_first_row_gross(self, film_page_cards_only_html):
        soup = BeautifulSoup(film_page_cards_only_html, "html.parser")
        rows = parse_collection_cards(soup)
        assert rows[0]["gross"] == pytest.approx(8.5)

    def test_day_label_from_data_attribute(self, film_page_cards_only_html):
        soup = BeautifulSoup(film_page_cards_only_html, "html.parser")
        rows = parse_collection_cards(soup)
        assert rows[0]["date"] == "Day 1"
        assert rows[0]["day"]  == "Day 1"

    def test_first_row_chg_day_is_none(self, film_page_cards_only_html):
        soup = BeautifulSoup(film_page_cards_only_html, "html.parser")
        rows = parse_collection_cards(soup)
        assert rows[0]["chg_day"] is None

    def test_running_total_accumulates(self, film_page_cards_only_html):
        soup = BeautifulSoup(film_page_cards_only_html, "html.parser")
        rows = parse_collection_cards(soup)
        assert rows[-1]["total"] == pytest.approx(8.5 + 6.2 + 5.1, abs=0.01)

    def test_required_keys_present(self, film_page_cards_only_html):
        soup = BeautifulSoup(film_page_cards_only_html, "html.parser")
        rows = parse_collection_cards(soup)
        for row in rows:
            assert set(row.keys()) == {"date", "day", "gross", "total", "chg_day"}

    def test_no_collection_cards_div_returns_empty(self, no_data_html):
        soup = BeautifulSoup(no_data_html, "html.parser")
        assert parse_collection_cards(soup) == []

    def test_empty_collection_cards_div_returns_empty(self):
        html = '<html><body><div id="collection-cards-2"></div></body></html>'
        soup = BeautifulSoup(html, "html.parser")
        assert parse_collection_cards(soup) == []

    def test_chg_day_computed_correctly(self, film_page_cards_only_html):
        soup = BeautifulSoup(film_page_cards_only_html, "html.parser")
        rows = parse_collection_cards(soup)
        expected = round((6.2 / 8.5 - 1) * 100, 1)
        assert rows[1]["chg_day"] == pytest.approx(expected, abs=0.1)

    def test_card_with_rupee_no_space_format(self):
        html = """
        <html><body>
        <div id="collection-cards-2">
          <a class="collection-card" data-day="1"><div>₹5.50Cr</div></a>
          <a class="collection-card" data-day="2"><div>₹4.25Cr</div></a>
        </div>
        </body></html>
        """
        soup = BeautifulSoup(html, "html.parser")
        rows = parse_collection_cards(soup)
        assert len(rows) == 2
        assert rows[0]["gross"] == pytest.approx(5.50)
        assert rows[1]["gross"] == pytest.approx(4.25)

    def test_card_with_space_after_rupee_symbol(self):
        html = """
        <html><body>
        <div id="collection-cards-2">
          <a class="collection-card" data-day="1"><div>₹ 2.9Cr</div></a>
        </div>
        </body></html>
        """
        soup = BeautifulSoup(html, "html.parser")
        rows = parse_collection_cards(soup)
        assert rows[0]["gross"] == pytest.approx(2.9)


class TestParseDailyTablePriority:
    """Verify the parse_daily_table() fallback chain."""

    def test_chart_data_takes_priority_over_cards(self, film_page_chart_html):
        """When both chart script and cards are present, chart wins."""
        soup = BeautifulSoup(film_page_chart_html, "html.parser")
        rows = parse_daily_table(soup)
        # Chart script has 5 rows with first gross=15.2
        assert len(rows) == 5
        assert rows[0]["gross"] == pytest.approx(15.2)

    def test_falls_back_to_cards_when_no_chart(self, film_page_cards_only_html):
        """When no chart script, use collection-cards."""
        soup = BeautifulSoup(film_page_cards_only_html, "html.parser")
        rows = parse_daily_table(soup)
        assert len(rows) == 3
        assert rows[0]["gross"] == pytest.approx(8.5)

    def test_falls_back_to_html_table(self, sample_table_html):
        """Legacy HTML table still works as tertiary fallback."""
        soup = BeautifulSoup(sample_table_html, "html.parser")
        rows = parse_daily_table(soup)
        assert len(rows) == 5

    def test_falls_back_to_div_layout(self, sample_div_html):
        """Legacy div layout works as final fallback."""
        soup = BeautifulSoup(sample_div_html, "html.parser")
        rows = parse_daily_table(soup)
        assert len(rows) == 3

    def test_empty_page_returns_empty(self, no_data_html):
        soup = BeautifulSoup(no_data_html, "html.parser")
        assert parse_daily_table(soup) == []
