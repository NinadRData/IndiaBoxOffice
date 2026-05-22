"""End-to-end integration tests using mocked HTTP (responses library)."""

import json
import sys
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import pytest
import responses as responses_lib

from sacnilk_scraper import BASE_URL, TOPBAR_URL, main, scrape_film


# ── scrape_film() helper ──────────────────────────────────────────────────────

@responses_lib.activate
def test_scrape_film_returns_rows_and_slug(sample_table_html):
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/BhootBhangla-2025/",
        body=sample_table_html,
        status=200,
    )
    rows, slug = scrape_film("Bhoot Bhangla", 2025)
    assert len(rows) == 5
    assert slug == "BhootBhangla-2025"


@responses_lib.activate
def test_scrape_film_returns_empty_on_404():
    responses_lib.add(responses_lib.GET, f"{BASE_URL}/Unknown-2025/", status=404)
    responses_lib.add(responses_lib.GET, f"{BASE_URL}/collection/Unknown-2025/", status=404)
    responses_lib.add(responses_lib.GET, f"{BASE_URL}/box-office/Unknown-2025/", status=404)
    # All slug variants → 404
    for slug in ["Unknown-2025", "Unknown", "unknown-2025", "unknown"]:
        for path in ["", "collection/", "box-office/"]:
            responses_lib.add(
                responses_lib.GET, f"{BASE_URL}/{path}{slug}/", status=404
            )
    rows, slug = scrape_film("Unknown", 2025)
    assert rows == []
    assert slug is None


# ── main() CLI ────────────────────────────────────────────────────────────────

@responses_lib.activate
def test_main_json_mode_prints_json(sample_table_html, capsys):
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/BhootBhangla-2025/",
        body=sample_table_html,
        status=200,
    )
    rc = main(["Bhoot Bhangla", "--year", "2025", "--json"])
    assert rc == 0
    captured = capsys.readouterr()
    # Progress lines appear before the JSON; find the array start
    out = captured.out
    json_start = out.find("[")
    assert json_start != -1, f"No JSON array found in output: {out!r}"
    data = json.loads(out[json_start:])
    assert isinstance(data, list)
    assert len(data) == 5


@responses_lib.activate
def test_main_writes_output_file(sample_table_html, tmp_path):
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/BhootBhangla-2025/",
        body=sample_table_html,
        status=200,
    )
    rc = main(["Bhoot Bhangla", "--year", "2025", "--output", str(tmp_path)])
    assert rc == 0
    out_file = tmp_path / "BhootBhangla-2025.json"
    assert out_file.exists()
    data = json.loads(out_file.read_text(encoding="utf-8"))
    assert len(data) == 5


@responses_lib.activate
def test_main_exits_nonzero_when_film_not_found():
    for slug in ["Unknown-2025", "Unknown", "unknown-2025", "unknown"]:
        for path in ["", "collection/", "box-office/"]:
            responses_lib.add(
                responses_lib.GET, f"{BASE_URL}/{path}{slug}/", status=404
            )
    rc = main(["Unknown", "--year", "2025"])
    assert rc == 1


@responses_lib.activate
def test_main_topbar_mode_prints_films(topbar_real_html, capsys):
    responses_lib.add(
        responses_lib.GET,
        TOPBAR_URL,
        body=topbar_real_html,
        status=200,
    )
    rc = main(["--topbar"])
    assert rc == 0
    captured = capsys.readouterr()
    # Summary table should contain at least one film name
    assert "Bhoot Bhangla" in captured.out or "film" in captured.out.lower()


@responses_lib.activate
def test_main_topbar_json_mode(topbar_real_html, capsys):
    responses_lib.add(
        responses_lib.GET,
        TOPBAR_URL,
        body=topbar_real_html,
        status=200,
    )
    rc = main(["--topbar", "--json"])
    assert rc == 0
    captured = capsys.readouterr()
    out = captured.out
    json_start = out.find("[")
    assert json_start != -1, f"No JSON array found in output: {out!r}"
    data = json.loads(out[json_start:])
    assert isinstance(data, list)


@responses_lib.activate
def test_main_topbar_writes_output_file(topbar_real_html, tmp_path):
    responses_lib.add(
        responses_lib.GET,
        TOPBAR_URL,
        body=topbar_real_html,
        status=200,
    )
    rc = main(["--topbar", "--output", str(tmp_path)])
    assert rc == 0
    assert (tmp_path / "topbar.json").exists()


@responses_lib.activate
def test_main_topbar_fails_when_network_down():
    import requests as req
    responses_lib.add(
        responses_lib.GET,
        TOPBAR_URL,
        body=req.ConnectionError("offline"),
    )
    rc = main(["--topbar"])
    assert rc == 1


@responses_lib.activate
def test_main_js_mode_prints_snippet(sample_table_html, capsys):
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/BhootBhangla-2025/",
        body=sample_table_html,
        status=200,
    )
    rc = main(["Bhoot Bhangla", "--year", "2025", "--js"])
    assert rc == 0
    captured = capsys.readouterr()
    assert "date:" in captured.out
    assert "gross:" in captured.out
