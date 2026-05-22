"""Shared fixtures for the sacnilk scraper test suite."""

import sys
import os
from pathlib import Path
from unittest.mock import MagicMock

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"

# Make the scraper importable without installation
sys.path.insert(0, str(Path(__file__).parent.parent))


def _load_fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


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


def make_response(html: str, status_code: int = 200, url: str = "https://sacnilk.com/BhootBhangla-2025/") -> MagicMock:
    """Build a mock requests.Response with the given HTML body."""
    mock = MagicMock()
    mock.status_code = status_code
    mock.text = html
    mock.url = url
    return mock


@pytest.fixture
def mock_200(sample_table_html):
    return make_response(sample_table_html)


@pytest.fixture
def mock_404():
    return make_response("", status_code=404, url="https://sacnilk.com/notfound/")
