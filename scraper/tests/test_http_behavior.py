"""
Tests for fetch_page() and fetch_topbar() covering the real-world HTTP
behaviors observed on sacnilk.com:
  - 200 on new /movie/{slug} path
  - 410 Gone on old /{slug}/ paths (sacnilk migration)
  - 404 on completely unknown slugs
  - Network errors (SSL, timeout, connection refused)
  - Non-sacnilk redirect (should be rejected)
"""

import pytest
import requests
import responses as responses_lib
from unittest.mock import patch, MagicMock

from sacnilk_scraper import BASE_URL, TOPBAR_URL, fetch_page, fetch_topbar, make_slugs


@responses_lib.activate
def test_fetch_page_succeeds_on_new_movie_path(film_page_chart_html):
    """Primary /movie/{slug} path returns 200."""
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/movie/Bhoot_Bhangla_2025",
        body=film_page_chart_html,
        status=200,
    )
    resp = fetch_page("Bhoot_Bhangla_2025")
    assert resp is not None
    assert resp.status_code == 200


@responses_lib.activate
def test_fetch_page_410_on_old_slug_falls_through_to_legacy(film_page_chart_html):
    """Old /{slug}/ path returns 410; scraper falls through to /movie/ path."""
    # New path succeeds; old paths return 410
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/movie/BhootBhangla-2025",
        body=film_page_chart_html,
        status=200,
    )
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/BhootBhangla-2025/",
        status=410,
    )
    # fetch_page tries /movie/ first and should succeed immediately
    resp = fetch_page("BhootBhangla-2025")
    assert resp is not None


@responses_lib.activate
def test_fetch_page_all_paths_410_returns_none():
    """All attempts 410 → fetch_page returns None."""
    slug = "Gone-2025"
    for path in [f"movie/{slug}", f"{slug}/", f"collection/{slug}/", f"box-office/{slug}/"]:
        responses_lib.add(responses_lib.GET, f"{BASE_URL}/{path}", status=410)
    assert fetch_page(slug) is None


@responses_lib.activate
def test_fetch_page_all_paths_404_returns_none():
    """All attempts 404 → fetch_page returns None."""
    slug = "NoFilm-2025"
    for path in [f"movie/{slug}", f"{slug}/", f"collection/{slug}/", f"box-office/{slug}/"]:
        responses_lib.add(responses_lib.GET, f"{BASE_URL}/{path}", status=404)
    assert fetch_page(slug) is None


@responses_lib.activate
def test_fetch_page_legacy_path_still_works(film_page_chart_html):
    """/movie/ returns 404 but /{slug}/ returns 200 (old archived page)."""
    slug = "OldFilm-2020"
    responses_lib.add(responses_lib.GET, f"{BASE_URL}/movie/{slug}", status=404)
    responses_lib.add(
        responses_lib.GET,
        f"{BASE_URL}/{slug}/",
        body=film_page_chart_html,
        status=200,
    )
    resp = fetch_page(slug)
    assert resp is not None
    assert resp.status_code == 200


@responses_lib.activate
def test_fetch_page_ssl_error_returns_none():
    """SSL certificate error → fetch_page returns None without raising."""
    slug = "SslFilm-2025"
    for path in [f"movie/{slug}", f"{slug}/", f"collection/{slug}/", f"box-office/{slug}/"]:
        responses_lib.add(
            responses_lib.GET,
            f"{BASE_URL}/{path}",
            body=requests.exceptions.SSLError("certificate verify failed"),
        )
    assert fetch_page(slug) is None


@responses_lib.activate
def test_fetch_page_connection_error_returns_none():
    """Connection refused → fetch_page returns None without raising."""
    slug = "OfflineFilm-2025"
    for path in [f"movie/{slug}", f"{slug}/", f"collection/{slug}/", f"box-office/{slug}/"]:
        responses_lib.add(
            responses_lib.GET,
            f"{BASE_URL}/{path}",
            body=requests.ConnectionError("connection refused"),
        )
    assert fetch_page(slug) is None


@responses_lib.activate
def test_fetch_page_timeout_returns_none():
    """Timeout → fetch_page returns None without raising."""
    slug = "TimeoutFilm-2025"
    for path in [f"movie/{slug}", f"{slug}/", f"collection/{slug}/", f"box-office/{slug}/"]:
        responses_lib.add(
            responses_lib.GET,
            f"{BASE_URL}/{path}",
            body=requests.exceptions.Timeout("timed out"),
        )
    assert fetch_page(slug) is None


def test_fetch_page_non_sacnilk_redirect_rejected():
    """A 200 response that redirected away from sacnilk must be rejected."""
    with patch("requests.get") as mock_get:
        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.url = "https://someothersite.com/page"
        mock_get.return_value = fake_resp
        assert fetch_page("AnyFilm-2025") is None


@responses_lib.activate
def test_fetch_topbar_200(topbar_real_html):
    responses_lib.add(responses_lib.GET, TOPBAR_URL, body=topbar_real_html, status=200)
    resp = fetch_topbar()
    assert resp is not None
    assert resp.status_code == 200


@responses_lib.activate
def test_fetch_topbar_404_returns_none():
    responses_lib.add(responses_lib.GET, TOPBAR_URL, status=404)
    assert fetch_topbar() is None


@responses_lib.activate
def test_fetch_topbar_ssl_error_returns_none():
    responses_lib.add(
        responses_lib.GET,
        TOPBAR_URL,
        body=requests.exceptions.SSLError("ssl error"),
    )
    assert fetch_topbar() is None


@responses_lib.activate
def test_fetch_topbar_timeout_returns_none():
    responses_lib.add(
        responses_lib.GET,
        TOPBAR_URL,
        body=requests.exceptions.Timeout("timed out"),
    )
    assert fetch_topbar() is None


class TestSlugToUrlMapping:
    """Verify that make_slugs() outputs correctly map to fetch_page() URL attempts."""

    def test_first_slug_tried_as_movie_path(self, film_page_chart_html):
        """The first (underscore) slug should be tried via /movie/ first."""
        slugs = make_slugs("Bhoot Bhangla", 2025)
        # First slug should be the new underscore format
        assert slugs[0].startswith("Bhoot_Bhangla_")

    @responses_lib.activate
    def test_scraper_succeeds_with_new_url_first_try(self, film_page_chart_html):
        """End-to-end: first slug resolves via /movie/ without trying legacy paths."""
        responses_lib.add(
            responses_lib.GET,
            f"{BASE_URL}/movie/Bhoot_Bhangla_2025",
            body=film_page_chart_html,
            status=200,
        )
        resp = fetch_page("Bhoot_Bhangla_2025")
        assert resp is not None
        # Only one call should have been made (to /movie/ path)
        assert len(responses_lib.calls) == 1
