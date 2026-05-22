"""Shared fixtures for the sacnilk scraper test suite."""

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"

# Make the scraper importable without installation
sys.path.insert(0, str(Path(__file__).parent.parent))


def _load_fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


# ── Legacy simple fixtures ────────────────────────────────────────────────────

@pytest.fixture
def sample_table_html() -> str:
    return _load_fixture("sample_table.html")


@pytest.fixture
def sample_div_html() -> str:
    return _load_fixture("sample_div.html")


@pytest.fixture
def sample_topbar_html() -> str:
    return _load_fixture("sample_topbar.html")


@pytest.fixture
def no_data_html() -> str:
    return _load_fixture("no_data.html")


# ── Real-structure fixtures (based on actual sacnilk 2025+ HTML) ─────────────

@pytest.fixture
def film_page_chart_html() -> str:
    """Film page with inline Chart.js arrays and collection-cards div."""
    return _load_fixture("film_page_chart_data.html")


@pytest.fixture
def film_page_cards_only_html() -> str:
    """Film page with collection-cards div but no chart script."""
    return _load_fixture("film_page_cards_only.html")


@pytest.fixture
def film_page_multiday_html() -> str:
    """Film page with 10 days of chart data."""
    return _load_fixture("film_page_multiday.html")


@pytest.fixture
def topbar_real_html() -> str:
    """Topbar page with real movie-card div structure."""
    return _load_fixture("topbar_real.html")


# ── Response mock helpers ─────────────────────────────────────────────────────

def make_response(
    html: str,
    status_code: int = 200,
    url: str = "https://sacnilk.com/movie/Bhoot_Bhangla_2025",
) -> MagicMock:
    """Build a mock requests.Response with the given HTML body."""
    mock = MagicMock()
    mock.status_code = status_code
    mock.text = html
    mock.url = url
    return mock


@pytest.fixture
def mock_200(film_page_chart_html):
    return make_response(film_page_chart_html)


@pytest.fixture
def mock_404():
    return make_response("", status_code=404, url="https://sacnilk.com/notfound/")


@pytest.fixture
def mock_410():
    return make_response(
        "<html><body>Gone</body></html>",
        status_code=410,
        url="https://sacnilk.com/BhootBhangla-2025/",
    )
