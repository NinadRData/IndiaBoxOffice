"""
Tests for parse_chart_data() — the primary parser for the current sacnilk
layout where daily collection is embedded in inline Chart.js JS arrays.
"""

import pytest
from bs4 import BeautifulSoup

from sacnilk_scraper import parse_chart_data


def make_soup(script_body: str) -> BeautifulSoup:
    html = f"<html><body><script>{script_body}</script></body></html>"
    return BeautifulSoup(html, "html.parser")


class TestParseChartData:

    def test_extracts_correct_row_count(self, film_page_chart_html):
        soup = BeautifulSoup(film_page_chart_html, "html.parser")
        rows = parse_chart_data(soup)
        assert len(rows) == 5

    def test_first_row_gross(self, film_page_chart_html):
        soup = BeautifulSoup(film_page_chart_html, "html.parser")
        rows = parse_chart_data(soup)
        assert rows[0]["gross"] == pytest.approx(15.2)

    def test_first_row_label_used_as_date_and_day(self, film_page_chart_html):
        soup = BeautifulSoup(film_page_chart_html, "html.parser")
        rows = parse_chart_data(soup)
        assert rows[0]["date"] == "Day 1"
        assert rows[0]["day"]  == "Day 1"

    def test_first_row_chg_day_is_none(self, film_page_chart_html):
        soup = BeautifulSoup(film_page_chart_html, "html.parser")
        rows = parse_chart_data(soup)
        assert rows[0]["chg_day"] is None

    def test_second_row_chg_day_is_negative(self, film_page_chart_html):
        soup = BeautifulSoup(film_page_chart_html, "html.parser")
        rows = parse_chart_data(soup)
        # Day 2 (12.5) < Day 1 (15.2)
        assert rows[1]["chg_day"] is not None
        assert rows[1]["chg_day"] < 0

    def test_running_total_accumulates(self, film_page_chart_html):
        soup = BeautifulSoup(film_page_chart_html, "html.parser")
        rows = parse_chart_data(soup)
        expected = round(15.2 + 12.5 + 10.0 + 18.3 + 22.1, 2)
        assert rows[-1]["total"] == pytest.approx(expected, abs=0.01)

    def test_required_keys_present(self, film_page_chart_html):
        soup = BeautifulSoup(film_page_chart_html, "html.parser")
        rows = parse_chart_data(soup)
        for row in rows:
            assert set(row.keys()) == {"date", "day", "gross", "total", "chg_day"}

    def test_multiday_row_count(self, film_page_multiday_html):
        soup = BeautifulSoup(film_page_multiday_html, "html.parser")
        rows = parse_chart_data(soup)
        assert len(rows) == 10

    def test_multiday_total_accumulation(self, film_page_multiday_html):
        soup = BeautifulSoup(film_page_multiday_html, "html.parser")
        rows = parse_chart_data(soup)
        expected = round(42.5+38.2+31.0+22.8+18.5+25.6+30.1+15.3+12.1+9.8, 2)
        assert rows[-1]["total"] == pytest.approx(expected, abs=0.01)

    def test_page_without_chart_script_returns_empty(self, no_data_html):
        soup = BeautifulSoup(no_data_html, "html.parser")
        assert parse_chart_data(soup) == []

    def test_net_data_only_no_gross_still_works(self):
        script = """
        const labels  = ["Day 1", "Day 2"];
        const netData = [5.0, 4.0];
        """
        rows = parse_chart_data(make_soup(script))
        assert len(rows) == 2
        assert rows[0]["gross"] == 5.0

    def test_single_day_film(self):
        script = """
        const labels   = ["Day 1"];
        const netData  = [2.9];
        const grossData = [3.393];
        """
        rows = parse_chart_data(make_soup(script))
        assert len(rows) == 1
        assert rows[0]["gross"] == pytest.approx(2.9)
        assert rows[0]["chg_day"] is None
        assert rows[0]["total"] == pytest.approx(2.9)

    def test_labels_missing_falls_back_to_day_n(self):
        script = """
        const netData = [10.0, 8.0];
        """
        rows = parse_chart_data(make_soup(script))
        assert rows[0]["date"] == "Day 1"
        assert rows[1]["date"] == "Day 2"

    def test_chg_day_positive_on_increase(self):
        script = """
        const labels  = ["Day 1", "Day 2"];
        const netData = [5.0, 7.5];
        """
        rows = parse_chart_data(make_soup(script))
        assert rows[1]["chg_day"] == pytest.approx(50.0, abs=0.1)

    def test_chg_day_exact_calculation(self):
        script = """
        const labels  = ["Day 1", "Day 2"];
        const netData = [10.0, 8.0];
        """
        rows = parse_chart_data(make_soup(script))
        expected = round((8.0 / 10.0 - 1) * 100, 1)
        assert rows[1]["chg_day"] == pytest.approx(expected, abs=0.1)

    def test_malformed_json_array_returns_empty(self):
        script = "const netData = [1.0, 2.0"  # unterminated
        assert parse_chart_data(make_soup(script)) == []

    def test_only_parses_script_containing_netdata(self, film_page_chart_html):
        # The fixture has both cards and a chart script.
        # parse_chart_data must return data from the script, not from the cards.
        soup = BeautifulSoup(film_page_chart_html, "html.parser")
        rows = parse_chart_data(soup)
        # Values come from the chart script (15.2, 12.5, 10.0, 18.3, 22.1)
        assert rows[0]["gross"] == pytest.approx(15.2)
