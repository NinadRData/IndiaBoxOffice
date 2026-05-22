"""Tests for make_movie_slug() and the updated make_slugs()."""

import pytest
from sacnilk_scraper import make_movie_slug, make_slugs


class TestMakeMovieSlug:
    """make_movie_slug() generates the /movie/{slug} path component."""

    def test_two_word_title(self):
        assert make_movie_slug("Bhoot Bhangla", 2025) == "Bhoot_Bhangla_2025"

    def test_single_word_title(self):
        assert make_movie_slug("Kalki", 2025) == "Kalki_2025"

    def test_three_word_title(self):
        assert make_movie_slug("Chand Mera Dil", 2026) == "Chand_Mera_Dil_2026"

    def test_title_with_number(self):
        assert make_movie_slug("Dhurandhar 2", 2026) == "Dhurandhar_2_2026"

    def test_title_with_special_chars_stripped(self):
        slug = make_movie_slug("Don't Stop!", 2025)
        assert "!" not in slug
        assert "'" not in slug

    def test_lowercase_input_title_cased(self):
        slug = make_movie_slug("bhoot bhangla", 2025)
        assert slug == "Bhoot_Bhangla_2025"

    def test_year_appended(self):
        slug = make_movie_slug("Any Film", 2030)
        assert slug.endswith("_2030")

    def test_uses_underscores_not_hyphens(self):
        slug = make_movie_slug("Multi Word Title", 2025)
        assert "_" in slug
        assert "-" not in slug


class TestMakeSlugs:
    """make_slugs() returns an ordered list; new format must come first."""

    def test_first_slug_is_underscore_format(self):
        slugs = make_slugs("Bhoot Bhangla", 2025)
        assert slugs[0] == "Bhoot_Bhangla_2025"

    def test_second_slug_is_lowercase_underscore(self):
        slugs = make_slugs("Bhoot Bhangla", 2025)
        assert slugs[1] == "bhoot_bhangla_2025"

    def test_old_camelcase_slug_still_present(self):
        slugs = make_slugs("Bhoot Bhangla", 2025)
        assert "BhootBhangla-2025" in slugs

    def test_old_hyphen_slug_still_present(self):
        slugs = make_slugs("Bhoot Bhangla", 2025)
        assert "Bhoot-Bhangla-2025" in slugs

    def test_returns_at_least_five_candidates(self):
        assert len(make_slugs("Any Film", 2025)) >= 5

    def test_year_not_in_last_slug(self):
        slugs = make_slugs("Bhoot Bhangla", 2025)
        assert "2025" not in slugs[-1]

    def test_numeric_word_in_title(self):
        slugs = make_slugs("Dhurandhar 2", 2026)
        assert slugs[0] == "Dhurandhar_2_2026"

    def test_single_word_title(self):
        slugs = make_slugs("Kalki", 2025)
        assert slugs[0] == "Kalki_2025"
