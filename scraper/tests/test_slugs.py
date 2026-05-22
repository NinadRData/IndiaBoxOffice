"""Tests for make_slugs()."""

import pytest
from sacnilk_scraper import make_slugs


def test_make_slugs_basic():
    slugs = make_slugs("Bhoot Bhangla", 2025)
    assert slugs[0] == "BhootBhangla-2025"
    assert slugs[1] == "Bhoot-Bhangla-2025"
    assert slugs[2] == "bhoot-bhangla-2025"
    assert slugs[3] == "BhootBhangla"
    assert slugs[4] == "Bhoot-Bhangla"
    assert len(slugs) == 5


def test_make_slugs_single_word():
    slugs = make_slugs("Kalki", 2025)
    assert slugs[0] == "Kalki-2025"
    assert slugs[1] == "Kalki-2025"    # single word: joined == hyphen
    assert slugs[2] == "kalki-2025"
    assert slugs[3] == "Kalki"


def test_make_slugs_three_words():
    slugs = make_slugs("Dhurandhar The Return", 2026)
    assert slugs[0] == "DhurandharTheReturn-2026"
    assert slugs[1] == "Dhurandhar-The-Return-2026"
    assert slugs[2] == "dhurandhar-the-return-2026"


def test_make_slugs_special_chars_stripped():
    slugs = make_slugs("Don't Stop!", 2025)
    # Apostrophe and exclamation mark should be removed
    assert "!" not in slugs[0]
    assert "'" not in slugs[0]
    # Words remaining: "Dont" "Stop"
    assert "DontStop-2025" in slugs


def test_make_slugs_year_in_first_slug():
    slugs = make_slugs("Any Film", 2030)
    assert "2030" in slugs[0]


def test_make_slugs_numeric_title():
    slugs = make_slugs("Dhurandhar 2", 2026)
    assert slugs[0] == "Dhurandhar2-2026"
    assert slugs[1] == "Dhurandhar-2-2026"


def test_make_slugs_year_absent_in_last_two():
    slugs = make_slugs("Bhoot Bhangla", 2025)
    # Last two slugs have no year suffix
    assert "2025" not in slugs[3]
    assert "2025" not in slugs[4]
