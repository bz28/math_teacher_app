"""Per-model Anthropic rates — the single source of truth for what a call costs.

Two consumers, one table: `llm_client._calc_cost` prices every live call
from here, and the admin unit-economics simulator reprices measured token
counts onto other models from the same numbers. They cannot drift.

Why this file exists at all: the rates used to live as a bare
`{model: (input, output)}` dict in llm_client, with ONE cache-read
multiplier applied to every model. That is wrong — Anthropic prices cache
hits per model, and Opus 5.5 reads a cached prefix at 0.05x base input,
not the 0.1x that holds for most models. Every Opus call we logged
between 2026-10-28 and the backfill therefore overstated its own cost.
A per-model multiplier is the fix, and it only works if there is exactly
one table carrying it.

`tokenizer_factor` is here for the simulator, not for billing. Claude 4.7
and later count the same text as roughly 30% more tokens than earlier
models, so repricing an Opus-measured call onto Sonnet 4.6 WITHOUT
dividing the token counts charges Sonnet for tokens it would never have
counted — and makes every cheaper alternative look ~30% worse than it is.
That is the one comparison the simulator exists to get right.

Rates verified against platform.claude.com/docs/en/about-claude/pricing
on 2026-11-24.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_PER_MTOK = 1_000_000

# Anthropic's published cache-write premium. Unlike the read multiplier
# this one really is uniform across models, for the 5-minute `ephemeral`
# cache we use. (The 1-hour cache writes at 2.0x; we don't use it.)
CACHE_WRITE_MULT = 1.25

# Tokens the pre-4.7 tokenizer produces for text that the 4.7+ tokenizer
# counts as 1.0. Anthropic documents the newer tokenizer as producing
# "approximately 30% more tokens for the same text".
_LEGACY_TOKENIZER_FACTOR = 1 / 1.30

# A trailing -YYYYMMDD on a model id is a pinned snapshot of the same
# model at the same price (settings.llm_model_haiku carries one). Strip it
# rather than maintaining an alias list that silently rots when the pin moves.
_DATE_SUFFIX = re.compile(r"-\d{8}$")


@dataclass(frozen=True)
class ModelPrice:
    """What one model charges, per token, in USD."""

    id: str
    label: str
    input_per_token: float
    output_per_token: float
    # Cache HIT price as a multiple of base input. Per-model: 0.05x on
    # Opus 5.5 / Sonnet 5.5, 0.025x on the Fable family, 0.1x elsewhere.
    cache_read_mult: float
    # Relative token count for identical text; see module docstring.
    tokenizer_factor: float
    # Models priced by prompt length (Haiku 5.5 only today) carry a second
    # rate that applies to a call whose TOTAL input — fresh + cache read +
    # cache write — crosses the threshold. None means flat pricing.
    long_context_threshold: int | None = None
    long_context_input_per_token: float | None = None
    long_context_output_per_token: float | None = None

    def rates_for(self, total_input_tokens: int) -> tuple[float, float]:
        """(input, output) rates for a call of this size.

        Flat for every model but Haiku 5.5, where a prompt over the
        threshold is billed at 5x on every token in the call — including
        the part under the threshold, so this is a cliff, not a tier.
        """
        if (
            self.long_context_threshold is not None
            and self.long_context_input_per_token is not None
            and self.long_context_output_per_token is not None
            and total_input_tokens > self.long_context_threshold
        ):
            return (
                self.long_context_input_per_token,
                self.long_context_output_per_token,
            )
        return (self.input_per_token, self.output_per_token)


def _mtok(usd: float) -> float:
    return usd / _PER_MTOK


# Ordered most to least capable; the admin model picker renders this order.
MODEL_CATALOG: tuple[ModelPrice, ...] = (
    ModelPrice(
        id="claude-fable-5-1",
        label="Fable 5.1",
        input_per_token=_mtok(10.0),
        output_per_token=_mtok(50.0),
        cache_read_mult=0.025,
        tokenizer_factor=1.0,
    ),
    ModelPrice(
        id="claude-opus-5-5",
        label="Opus 5.5",
        input_per_token=_mtok(4.0),
        output_per_token=_mtok(20.0),
        cache_read_mult=0.05,
        tokenizer_factor=1.0,
    ),
    ModelPrice(
        id="claude-opus-5",
        label="Opus 5",
        input_per_token=_mtok(5.0),
        output_per_token=_mtok(25.0),
        cache_read_mult=0.1,
        tokenizer_factor=1.0,
    ),
    ModelPrice(
        id="claude-sonnet-5-5",
        label="Sonnet 5.5",
        input_per_token=_mtok(2.0),
        output_per_token=_mtok(10.0),
        cache_read_mult=0.05,
        tokenizer_factor=1.0,
    ),
    ModelPrice(
        id="claude-sonnet-5",
        label="Sonnet 5",
        input_per_token=_mtok(2.0),
        output_per_token=_mtok(10.0),
        cache_read_mult=0.1,
        tokenizer_factor=1.0,
    ),
    ModelPrice(
        id="claude-sonnet-4-6",
        label="Sonnet 4.6",
        input_per_token=_mtok(3.0),
        output_per_token=_mtok(15.0),
        cache_read_mult=0.1,
        tokenizer_factor=_LEGACY_TOKENIZER_FACTOR,
    ),
    ModelPrice(
        id="claude-haiku-5-5",
        label="Haiku 5.5",
        input_per_token=_mtok(0.10),
        output_per_token=_mtok(0.50),
        cache_read_mult=0.1,
        tokenizer_factor=1.0,
        long_context_threshold=100_000,
        long_context_input_per_token=_mtok(0.50),
        long_context_output_per_token=_mtok(2.50),
    ),
    ModelPrice(
        id="claude-haiku-4-5",
        label="Haiku 4.5",
        input_per_token=_mtok(1.0),
        output_per_token=_mtok(5.0),
        cache_read_mult=0.1,
        tokenizer_factor=_LEGACY_TOKENIZER_FACTOR,
    ),
)

_BY_ID: dict[str, ModelPrice] = {m.id: m for m in MODEL_CATALOG}

# Unknown models fall back to this for LIVE billing only. Picked as the
# most expensive catalog entry on purpose: an unknown model that we
# under-price looks like a cheap call and silently flatters the spend
# dashboard, whereas over-pricing it trips the daily cost cap early and
# someone goes looking. The simulator never uses this — it surfaces an
# unknown model as unpriced rather than inventing a number.
_LIVE_FALLBACK = max(MODEL_CATALOG, key=lambda m: m.input_per_token)

_warned_unknown: set[str] = set()


def price_for(model: str) -> ModelPrice | None:
    """The catalog entry for a model id, or None if we don't price it.

    Accepts a pinned `-YYYYMMDD` snapshot of a known model.
    """
    found = _BY_ID.get(model)
    if found is not None:
        return found
    return _BY_ID.get(_DATE_SUFFIX.sub("", model))


def price_for_billing(model: str) -> ModelPrice:
    """Like `price_for`, but never None — for the live logging path.

    Pricing happens inside the logging of an otherwise-successful call, so
    an unrecognised model must not raise there. It warns once per model id
    instead, which is the signal to add a catalog entry.
    """
    found = price_for(model)
    if found is not None:
        return found
    if model not in _warned_unknown:
        _warned_unknown.add(model)
        logger.warning(
            "No pricing for model %r — billing it at %s rates. "
            "Add it to MODEL_CATALOG in api/core/model_pricing.py.",
            model,
            _LIVE_FALLBACK.id,
        )
    return _LIVE_FALLBACK


def cost_usd(
    price: ModelPrice,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float:
    """Price one call's measured token counts at one model's rates.

    `input_tokens` is the UNCACHED remainder — Anthropic reports cache
    traffic in its own fields, so the three input terms are disjoint and
    all three are billed.
    """
    input_rate, output_rate = price.rates_for(
        input_tokens + cache_read_tokens + cache_write_tokens,
    )
    return (
        (input_tokens * input_rate)
        + (output_tokens * output_rate)
        + (cache_read_tokens * input_rate * price.cache_read_mult)
        + (cache_write_tokens * input_rate * CACHE_WRITE_MULT)
    )


def reprice(
    source: ModelPrice,
    target: ModelPrice,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float:
    """What a call measured on `source` would have cost on `target`.

    Token counts are rescaled by the ratio of the two tokenizers first —
    the same text is a different number of tokens on each — and only then
    priced. Skipping that step is the ~30% error described in the module
    docstring, and it always runs in the direction that flatters whichever
    model we are already paying for.
    """
    scale = target.tokenizer_factor / source.tokenizer_factor
    return cost_usd(
        target,
        input_tokens=round(input_tokens * scale),
        output_tokens=round(output_tokens * scale),
        cache_read_tokens=round(cache_read_tokens * scale),
        cache_write_tokens=round(cache_write_tokens * scale),
    )
