"""Tests for write_output(), format_for_tracker(), and summarise()."""

import json
import sys
from io import StringIO
from pathlib import Path

import pytest

from sacnilk_scraper import format_for_tracker, summarise, write_output


SAMPLE_ROWS = [
    {"date": "Wed, Apr 16", "day": "Wed", "gross": 15.20, "total": 15.20, "chg_day": None},
    {"date": "Thu, Apr 17", "day": "Thu", "gross": 12.50, "total": 27.70, "chg_day": -17.8},
    {"date": "Fri, Apr 18", "day": "Fri", "gross": 10.00, "total": 37.70, "chg_day": -20.0},
]


class TestWriteOutput:
    def test_creates_json_file(self, tmp_path):
        out = write_output(SAMPLE_ROWS, "BhootBhangla-2025", str(tmp_path))
        assert Path(out).exists()

    def test_filename_uses_slug(self, tmp_path):
        write_output(SAMPLE_ROWS, "BhootBhangla-2025", str(tmp_path))
        assert (tmp_path / "BhootBhangla-2025.json").exists()

    def test_output_is_valid_json(self, tmp_path):
        path = write_output(SAMPLE_ROWS, "TestFilm-2025", str(tmp_path))
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        assert isinstance(data, list)
        assert len(data) == 3

    def test_output_json_structure(self, tmp_path):
        path = write_output(SAMPLE_ROWS, "TestFilm-2025", str(tmp_path))
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for row in data:
            assert "date" in row
            assert "day" in row
            assert "gross" in row
            assert "total" in row
            assert "chg_day" in row

    def test_creates_output_dir_if_missing(self, tmp_path):
        nested = tmp_path / "new" / "deep" / "dir"
        write_output(SAMPLE_ROWS, "film", str(nested))
        assert (nested / "film.json").exists()

    def test_returns_written_path(self, tmp_path):
        path = write_output(SAMPLE_ROWS, "slug123", str(tmp_path))
        assert "slug123.json" in path


class TestFormatForTracker:
    def test_output_contains_date(self):
        result = format_for_tracker(SAMPLE_ROWS, "Bhoot Bhangla")
        assert "Wed, Apr 16" in result

    def test_output_contains_gross(self):
        result = format_for_tracker(SAMPLE_ROWS, "Bhoot Bhangla")
        assert "15.2" in result

    def test_null_chg_day_rendered_as_null(self):
        result = format_for_tracker(SAMPLE_ROWS, "Bhoot Bhangla")
        assert "chgDay:null" in result

    def test_numeric_chg_day_rendered_with_sign(self):
        result = format_for_tracker(SAMPLE_ROWS, "Bhoot Bhangla")
        assert "-17.8" in result

    def test_title_in_comment_header(self):
        result = format_for_tracker(SAMPLE_ROWS, "Bhoot Bhangla")
        assert "Bhoot Bhangla" in result

    def test_empty_rows_produces_comment_only(self):
        result = format_for_tracker([], "Any Film")
        assert "Any Film" in result
        assert "{" not in result


class TestSummarise:
    def test_no_rows_does_not_crash(self, capsys):
        summarise([], "Test Film")
        captured = capsys.readouterr()
        assert "No rows parsed" in captured.out

    def test_prints_title(self, capsys):
        summarise(SAMPLE_ROWS, "Bhoot Bhangla")
        captured = capsys.readouterr()
        assert "Bhoot Bhangla" in captured.out

    def test_prints_days_tracked(self, capsys):
        summarise(SAMPLE_ROWS, "Bhoot Bhangla")
        captured = capsys.readouterr()
        assert "3" in captured.out

    def test_prints_running_total(self, capsys):
        summarise(SAMPLE_ROWS, "Bhoot Bhangla")
        captured = capsys.readouterr()
        assert "37.7" in captured.out

    def test_prints_down_arrow_on_drop(self, capsys):
        summarise(SAMPLE_ROWS, "Bhoot Bhangla")
        captured = capsys.readouterr()
        assert "▼" in captured.out
