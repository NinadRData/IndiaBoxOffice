"""Tests for make_slugs()."""

import pytest
from sacnilk_scraper import make_slugs


def test_make_slugs_basic():
    slugs = make_slugs("Bhoot Bhangla", 2025)
    assert slugs[0] == "Bhoot_Bhangla_2025"
    assert slugs[1] == "bhoot_bhangla_2025"
    assert slugs[2] == "BhootBhangla-2025"
    assert slugs[3] == "Bhoot-Bhangla-2025"
    assert slugs[4] == "bhoot-bhangla-2025"
    assert len(slugs) == 8


def test_make_slugs_single_word():
    slugs = make_slugs("Kalki", 2025)
    assert slugs[0] == "Kalki_2025"
    assert slugs[1] == "kalki_2025"
    assert slugs[2] == "Kalki-2025"


def test_make_slugs_three_words():
    slugs = make_slugs("Dhurandhar The Return", 2026)
    assert slugs[0] == "Dhurandhar_The_Return_2026"
    assert slugs[2] == "DhurandharTheReturn-2026"
    assert slugs[3] == "Dhurandhar-The-Return-2026"


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
    assert slugs[0] == "Dhurandhar_2_2026"
    assert slugs[2] == "Dhurandhar2-2026"
    assert slugs[3] == "Dhurandhar-2-2026"


def test_make_slugs_year_absent_in_last_two():
    slugs = make_slugs("Bhoot Bhangla", 2025)
    # Last three slugs (indices 5-7) have no year suffix
    assert "2025" not in slugs[5]
    assert "2025" not in slugs[6]
    assert "2025" not in slugs[7]
