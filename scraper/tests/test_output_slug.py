"""Tests for the --output-slug CLI flag.

Verifies that the canonical output filename can be pinned independently
of whichever URL slug sacnilk.com happens to respond to at runtime.
"""

import json
from pathlib import Path

import pytest
import responses as responses_lib

from sacnilk_scraper import BASE_URL, main


# Minimal sacnilk film page that satisfies parse_chart_data.
_CHART_HTML = """
<html><head></head><body>
<script>
const labels = ["Day 1","Day 2","Day 3"];
const netData = [15.20, 12.50, 10.00];
const grossData = [18.00, 15.00, 12.00];
</script>
</body></html>
"""

# The first URL slug attempted for "Bhoot Bhangla" 2025 is the new-format
# underscore variant; mock that URL so responses_lib intercepts it first.
_PRIMARY_URL = f"{BASE_URL}/movie/Bhoot_Bhangla_2025"


class TestOutputSlugOverridesFilename:
    @responses_lib.activate
    def test_canonical_slug_used_as_filename(self, tmp_path):
        """--output-slug must produce a file named after the given slug."""
        responses_lib.add(responses_lib.GET, _PRIMARY_URL, body=_CHART_HTML, status=200)

        rc = main([
            "Bhoot Bhangla", "--year", "2025",
            "--output", str(tmp_path),
            "--output-slug", "BhootBhangla-2025",
        ])

        assert rc == 0
        assert (tmp_path / "BhootBhangla-2025.json").exists()

    @responses_lib.activate
    def test_canonical_slug_differs_from_url_slug(self, tmp_path):
        """Canonical slug may differ from the URL slug that resolved."""
        responses_lib.add(responses_lib.GET, _PRIMARY_URL, body=_CHART_HTML, status=200)

        rc = main([
            "Bhoot Bhangla", "--year", "2025",
            "--output", str(tmp_path),
            "--output-slug", "canonical-override",
        ])

        assert rc == 0
        assert (tmp_path / "canonical-override.json").exists()
        # The URL-derived slug file must NOT be created.
        assert not (tmp_path / "Bhoot_Bhangla_2025.json").exists()

    @responses_lib.activate
    def test_without_flag_uses_url_slug(self, tmp_path):
        """When --output-slug is omitted the filename is the URL slug."""
        responses_lib.add(responses_lib.GET, _PRIMARY_URL, body=_CHART_HTML, status=200)

        rc = main([
            "Bhoot Bhangla", "--year", "2025",
            "--output", str(tmp_path),
        ])

        assert rc == 0
        json_files = list(tmp_path.glob("*.json"))
        assert len(json_files) == 1
        # Name is whatever slug resolved — we don't assert the exact name,
        # just that exactly one file was created.

    @responses_lib.activate
    def test_output_file_contains_valid_rows(self, tmp_path):
        """File produced via --output-slug must contain well-formed JSON rows."""
        responses_lib.add(responses_lib.GET, _PRIMARY_URL, body=_CHART_HTML, status=200)

        rc = main([
            "Bhoot Bhangla", "--year", "2025",
            "--output", str(tmp_path),
            "--output-slug", "BhootBhangla-2025",
        ])

        assert rc == 0
        path = tmp_path / "BhootBhangla-2025.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        assert isinstance(data, list)
        assert len(data) == 3
        for row in data:
            assert "gross" in row
            assert "total" in row
            assert "chg_day" in row

    @responses_lib.activate
    def test_empty_output_slug_falls_back_to_url_slug(self, tmp_path):
        """An empty string for --output-slug behaves as if the flag were absent."""
        responses_lib.add(responses_lib.GET, _PRIMARY_URL, body=_CHART_HTML, status=200)

        rc = main([
            "Bhoot Bhangla", "--year", "2025",
            "--output", str(tmp_path),
            "--output-slug", "",
        ])

        assert rc == 0
        json_files = list(tmp_path.glob("*.json"))
        assert len(json_files) == 1

    @responses_lib.activate
    def test_output_slug_with_hyphens_and_digits(self, tmp_path):
        """Slugs containing hyphens and digits are written verbatim."""
        responses_lib.add(responses_lib.GET, _PRIMARY_URL, body=_CHART_HTML, status=200)

        rc = main([
            "Bhoot Bhangla", "--year", "2025",
            "--output", str(tmp_path),
            "--output-slug", "Dhurandhar2-2026",
        ])

        assert rc == 0
        assert (tmp_path / "Dhurandhar2-2026.json").exists()
