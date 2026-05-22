"""Tests for fetch_page() and fetch_topbar() using the responses mock library."""

import pytest
import responses as responses_lib
import requests

from sacnilk_scraper import fetch_page, fetch_topbar, BASE_URL, TOPBAR_URL


@responses_lib.activate
def test_fetch_page_first_slug_succeeds(sample_table_html):
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/BhootBhangla-2025/",
        body=sample_table_html,
        status=200,
    )
    resp = fetch_page("BhootBhangla-2025")
    assert resp is not None
    assert resp.status_code == 200


@responses_lib.activate
def test_fetch_page_fallback_to_collection_path(sample_table_html):
    """404 on /{slug}/, 200 on /collection/{slug}/."""
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/MyFilm-2025/",
        status=404,
    )
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/collection/MyFilm-2025/",
        body=sample_table_html,
        status=200,
    )
    resp = fetch_page("MyFilm-2025")
    assert resp is not None
    assert resp.status_code == 200


@responses_lib.activate
def test_fetch_page_fallback_to_box_office_path(sample_table_html):
    """404 on first two paths, 200 on /box-office/{slug}/."""
    responses_lib.add(responses_lib.GET, f"{BASE_URL}/MyFilm-2025/", status=404)
    responses_lib.add(responses_lib.GET, f"{BASE_URL}/collection/MyFilm-2025/", status=404)
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/box-office/MyFilm-2025/",
        body=sample_table_html,
        status=200,
    )
    resp = fetch_page("MyFilm-2025")
    assert resp is not None


@responses_lib.activate
def test_fetch_page_all_paths_fail():
    responses_lib.add(responses_lib.GET, f"{BASE_URL}/NoFilm-2025/", status=404)
    responses_lib.add(responses_lib.GET, f"{BASE_URL}/collection/NoFilm-2025/", status=404)
    responses_lib.add(responses_lib.GET, f"{BASE_URL}/box-office/NoFilm-2025/", status=404)
    resp = fetch_page("NoFilm-2025")
    assert resp is None


@responses_lib.activate
def test_fetch_page_network_error_returns_none():
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/AnyFilm-2025/",
        body=requests.ConnectionError("connection refused"),
    )
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/collection/AnyFilm-2025/",
        body=requests.ConnectionError("connection refused"),
    )
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/box-office/AnyFilm-2025/",
        body=requests.ConnectionError("connection refused"),
    )
    resp = fetch_page("AnyFilm-2025")
    assert resp is None


@responses_lib.activate
def test_fetch_topbar_returns_html(sample_topbar_html):
    responses_lib.add(
        responses_lib.GET,
        TOPBAR_URL,
        body=sample_topbar_html,
        status=200,
    )
    resp = fetch_topbar()
    assert resp is not None
    assert resp.status_code == 200


@responses_lib.activate
def test_fetch_topbar_404_returns_none():
    responses_lib.add(responses_lib.GET, TOPBAR_URL, status=404)
    resp = fetch_topbar()
    assert resp is None


@responses_lib.activate
def test_fetch_topbar_network_error_returns_none():
    responses_lib.add(
        responses_lib.GET,
        TOPBAR_URL,
        body=requests.ConnectionError("timeout"),
    )
    resp = fetch_topbar()
    assert resp is None


@responses_lib.activate
def test_fetch_page_non_sacnilk_redirect_returns_none():
    """A 200 response that redirected away from sacnilk should not be accepted."""
    mock = responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/Redirect-2025/",
        body="<html>redirect</html>",
        status=200,
    )
    # Simulate redirect by patching the response URL
    # The responses library uses the original URL; we test via a custom response
    # that returns a url not containing 'sacnilk'.
    import unittest.mock as mock_lib
    with mock_lib.patch("requests.get") as mock_get:
        fake_resp = mock_lib.MagicMock()
        fake_resp.status_code = 200
        fake_resp.url = "https://someothersite.com/page"
        mock_get.return_value = fake_resp
        resp = fetch_page("Redirect-2025")
        assert resp is None
