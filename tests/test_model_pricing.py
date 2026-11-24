"""The per-model rate table, and the two things it exists to get right.

1. Opus 5.5 reads a cached prefix at 0.05x base input, not the flat 0.1x
   that used to be applied to every model. That constant over-charged
   every cached Opus call by 2x from 2026-10-28 until the backfill, so
   this is pinned: if someone reintroduces a single shared read
   multiplier, these tests fail rather than the spend dashboard drifting.

2. Repricing a measured call onto another model rescales the token counts
   by the ratio of the two tokenizers first. Claude 4.7+ counts the same
   text as ~30% more tokens than Sonnet 4.6 does, so skipping the rescale
   overstates every older-tokenizer model — always in the direction that
   flatters whichever model we are already paying for.

Rates are checked against platform.claude.com/docs/en/about-claude/pricing.
"""

import pytest

from api.config import settings
from api.core.model_pricing import (
    CACHE_WRITE_MULT,
    MODEL_CATALOG,
    cost_usd,
    price_for,
    price_for_billing,
    reprice,
)

_MTOK = 1_000_000


def _price(model_id: str):
    p = price_for(model_id)
    assert p is not None, f"{model_id} missing from MODEL_CATALOG"
    return p


# --------------------------------------------------------------------------
# Published rates
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("model_id", "input_mtok", "output_mtok", "cache_read_mult"),
    [
        ("claude-opus-5-5", 4.0, 20.0, 0.05),
        ("claude-opus-5", 5.0, 25.0, 0.1),
        ("claude-sonnet-5-5", 2.0, 10.0, 0.05),
        ("claude-sonnet-4-6", 3.0, 15.0, 0.1),
        ("claude-haiku-5-5", 0.10, 0.50, 0.1),
        ("claude-haiku-4-5", 1.0, 5.0, 0.1),
        ("claude-fable-5-1", 10.0, 50.0, 0.025),
    ],
)
def test_published_rates(
    model_id: str, input_mtok: float, output_mtok: float, cache_read_mult: float,
) -> None:
    p = _price(model_id)
    assert p.input_per_token == pytest.approx(input_mtok / _MTOK)
    assert p.output_per_token == pytest.approx(output_mtok / _MTOK)
    assert p.cache_read_mult == pytest.approx(cache_read_mult)


def test_opus_cache_read_is_half_the_common_rate() -> None:
    """The specific bug this module was written to kill."""
    assert _price("claude-opus-5-5").cache_read_mult == pytest.approx(0.05)
    assert _price("claude-sonnet-4-6").cache_read_mult == pytest.approx(0.1)


def test_every_configured_model_is_priced() -> None:
    """The models we actually run must never fall through to the fallback."""
    for model_id in (
        settings.llm_model_opus,
        settings.llm_model_sonnet,
        settings.llm_model_haiku,
    ):
        assert price_for(model_id) is not None, model_id


def test_pinned_date_suffix_resolves_to_the_same_model() -> None:
    """settings.llm_model_haiku carries a -YYYYMMDD pin."""
    assert price_for("claude-haiku-4-5-20251001") is _price("claude-haiku-4-5")


def test_unknown_model_is_unpriced_for_the_simulator() -> None:
    assert price_for("claude-not-a-model") is None


def test_unknown_model_falls_back_to_most_expensive_for_billing() -> None:
    """Live logging must not raise; over-pricing is the safe direction.

    Under-pricing an unknown model hides it in the spend dashboard.
    Over-pricing trips the daily cost cap early and someone investigates.
    """
    fallback = price_for_billing("claude-not-a-model")
    assert fallback.input_per_token == max(m.input_per_token for m in MODEL_CATALOG)


# --------------------------------------------------------------------------
# Pricing one call
# --------------------------------------------------------------------------

def test_cost_sums_four_disjoint_token_buckets() -> None:
    p = _price("claude-opus-5-5")
    cost = cost_usd(
        p,
        input_tokens=1_000,
        output_tokens=500,
        cache_read_tokens=10_000,
        cache_write_tokens=2_000,
    )
    assert cost == pytest.approx(
        1_000 * p.input_per_token
        + 500 * p.output_per_token
        + 10_000 * p.input_per_token * 0.05
        + 2_000 * p.input_per_token * CACHE_WRITE_MULT,
    )


def test_cached_opus_call_costs_half_what_the_flat_rate_charged() -> None:
    """Reproduces the overstatement, in the direction of the real fix."""
    p = _price("claude-opus-5-5")
    read_tokens = 38_000
    correct = cost_usd(p, 0, 0, cache_read_tokens=read_tokens)
    overstated = read_tokens * p.input_per_token * 0.1
    assert correct == pytest.approx(overstated / 2)


def test_haiku_55_long_prompt_crosses_the_price_cliff() -> None:
    """Over 100k input tokens Haiku 5.5 bills every token at 5x."""
    p = _price("claude-haiku-5-5")
    under = cost_usd(p, input_tokens=99_000, output_tokens=1_000)
    over = cost_usd(p, input_tokens=101_000, output_tokens=1_000)
    assert over > under * 4, "crossing the threshold must reprice the whole call"
    assert p.rates_for(101_000) == (
        p.long_context_input_per_token,
        p.long_context_output_per_token,
    )


def test_cache_read_tokens_count_toward_the_long_context_threshold() -> None:
    """A cached prefix is still prompt length for pricing purposes."""
    p = _price("claude-haiku-5-5")
    assert p.rates_for(150_000) == (
        p.long_context_input_per_token,
        p.long_context_output_per_token,
    )
    flat = _price("claude-opus-5-5")
    assert flat.rates_for(150_000) == (flat.input_per_token, flat.output_per_token)


# --------------------------------------------------------------------------
# Repricing onto another model
# --------------------------------------------------------------------------

def test_reprice_onto_itself_is_identity() -> None:
    opus = _price("claude-opus-5-5")
    measured = cost_usd(opus, 4_200, 850, 1_000, 500)
    assert reprice(opus, opus, 4_200, 850, 1_000, 500) == pytest.approx(measured)


def test_reprice_to_older_tokenizer_shrinks_the_token_counts() -> None:
    """The ~30% correction. Without it Sonnet looks ~30% more expensive."""
    opus = _price("claude-opus-5-5")
    sonnet = _price("claude-sonnet-4-6")

    corrected = reprice(opus, sonnet, input_tokens=4_200, output_tokens=850)
    naive = cost_usd(sonnet, input_tokens=4_200, output_tokens=850)

    assert corrected < naive
    assert corrected == pytest.approx(naive / 1.30, rel=1e-3)


def test_reprice_to_newer_tokenizer_grows_the_token_counts() -> None:
    """Symmetry: measuring on Sonnet and pricing on Opus must scale up."""
    sonnet = _price("claude-sonnet-4-6")
    opus = _price("claude-opus-5-5")

    corrected = reprice(sonnet, opus, input_tokens=3_230, output_tokens=650)
    naive = cost_usd(opus, input_tokens=3_230, output_tokens=650)

    assert corrected > naive
    assert corrected == pytest.approx(naive * 1.30, rel=1e-3)


def test_reprice_between_same_tokenizer_family_does_not_rescale() -> None:
    opus = _price("claude-opus-5-5")
    sonnet55 = _price("claude-sonnet-5-5")
    assert reprice(opus, sonnet55, 4_200, 850) == pytest.approx(
        cost_usd(sonnet55, 4_200, 850),
    )


def test_reprice_applies_the_target_models_cache_multiplier() -> None:
    """Not the source's — the whole point of making it per-model."""
    sonnet = _price("claude-sonnet-4-6")
    opus = _price("claude-opus-5-5")
    repriced = reprice(sonnet, opus, 0, 0, cache_read_tokens=1_300)
    scaled = round(1_300 * (opus.tokenizer_factor / sonnet.tokenizer_factor))
    assert repriced == pytest.approx(scaled * opus.input_per_token * 0.05)
