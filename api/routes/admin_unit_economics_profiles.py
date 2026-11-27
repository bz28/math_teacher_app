"""How a unit's measured calls become per-function profiles and repriced
figures — the arithmetic half of /admin/unit-economics, split from the
queries so neither file outgrows a read.

Everything here is pure: rows in, dicts out. The queries that produce the
rows live in admin_unit_economics.py.
"""

from dataclasses import dataclass
from typing import Any

from api.config import settings
from api.core.model_pricing import (
    CACHE_WRITE_MULT,
    MODEL_CATALOG,
    cost_usd,
    price_for,
    reprice,
)

_PER_MTOK = 1_000_000


def as_float(value: Any) -> float:
    """Coalesce a possibly-NULL aggregate to a float."""
    return float(value) if value is not None else 0.0


def profile_rows(
    rows: list[Any], key_of: Any, denominators: dict[str, float],
) -> dict[str, list[dict[str, Any]]]:
    """Collapse per-(unit, function, model) rows into one entry per function.

    Keeps the DOMINANT model's token profile as the measurement to
    reprice from — mixing two models' token counts would reprice from a
    profile no single model ever produced.

    `denominators` is the count of units of each KIND, measured once and
    shared by every function. It must not be derived per function: a
    feature that fires on only some units (integrity is per-assignment,
    so the understanding check skips homeworks that disabled it) would
    then be divided by its own smaller count, inflating it and breaking
    the invariant the simulator depends on — that the per-function costs
    sum to the measured unit cost.
    """
    grouped: dict[tuple[str, str], list[Any]] = {}
    for r in rows:
        grouped.setdefault((key_of(r), r.function), []).append(r)

    out: dict[str, list[dict[str, Any]]] = {}
    for (kind, function), group in grouped.items():
        # By COST, not call count: a function with 1,000 cheap Haiku calls
        # and 50 huge Opus ones would otherwise reprice all 1,050 from the
        # cheap profile. Choosing by spend fails conservatively.
        # Tie-broken on model id so identical requests return identical
        # answers; a bare max() takes whichever row Postgres emitted first.
        dominant = max(group, key=lambda r: (as_float(r.cost), r.model))
        calls = sum(float(r.calls) for r in group)
        cost = sum(as_float(r.cost) for r in group)
        units = denominators.get(kind) or 1.0
        tokens = {
            "input": as_float(dominant.avg_in),
            "output": as_float(dominant.avg_out),
            "cache_read": as_float(dominant.avg_cread),
            "cache_write": as_float(dominant.avg_cwrite),
        }
        calls_per_unit = calls / units
        legs = [
            _Leg(
                model=r.model,
                calls_per_unit=float(r.calls) / units,
                input=as_float(r.avg_in),
                output=as_float(r.avg_out),
                cache_read=as_float(r.avg_cread),
                cache_write=as_float(r.avg_cwrite),
            )
            for r in group
        ]
        out.setdefault(kind, []).append(
            {
                "function": function,
                "models": sorted({r.model for r in group}),
                "measured_model": dominant.model,
                # The catalog entry that model id resolves to. A logged id
                # can carry a -YYYYMMDD pin (settings.llm_model_haiku does),
                # which matches no catalog id and no <option> value — the
                # dashboard's model picker silently fell back to the first
                # option when seeded from the raw id.
                "measured_catalog_id": (
                    measured.id if (measured := price_for(dominant.model)) else None
                ),
                "calls_per_unit": calls_per_unit,
                "cost_per_unit": cost / units,
                "tokens": tokens,
                "reprice": _reprice_legs(legs),
                # Every leg repriced onto the model it actually ran on.
                # Equals cost_per_unit when the arithmetic is sound, which
                # is what the dashboard's trust badge compares against —
                # and unlike "reprice at the dominant model" it stays a
                # true identity when a function spans several models.
                "self_reprice": _self_reprice(legs),
            },
        )
    for fns in out.values():
        fns.sort(key=lambda f: f["cost_per_unit"], reverse=True)
    return out

@dataclass(frozen=True)
class _Leg:
    """One (function, model) slice of a unit's work."""

    model: str
    calls_per_unit: float
    input: float
    output: float
    cache_read: float
    cache_write: float


def _reprice_legs(legs: list[_Leg]) -> dict[str, float | None]:
    """What this function would cost per unit on each catalog model.

    Each leg is repriced from ITS OWN measured profile and the result
    summed. Repricing the group's total call count off a single model's
    profile overstates any mixed-model group by the ratio between them.

    None for a target we cannot price any leg from — an unknown source
    model means there is no profile to rescale, and inventing one is how
    a simulator starts lying.
    """
    out: dict[str, float | None] = {}
    sources = [(leg, price_for(leg.model)) for leg in legs]
    for target in MODEL_CATALOG:
        total = 0.0
        for leg, source in sources:
            if source is None:
                out[target.id] = None
                break
            total += leg.calls_per_unit * reprice(
                source,
                target,
                input_tokens=leg.input,
                output_tokens=leg.output,
                cache_read_tokens=leg.cache_read,
                cache_write_tokens=leg.cache_write,
            )
        else:
            out[target.id] = total
    return out


def _self_reprice(legs: list[_Leg]) -> float | None:
    """Every leg priced on the model it actually ran on."""
    total = 0.0
    for leg in legs:
        source = price_for(leg.model)
        if source is None:
            return None
        total += leg.calls_per_unit * cost_usd(
            source,
            input_tokens=leg.input,
            output_tokens=leg.output,
            cache_read_tokens=leg.cache_read,
            cache_write_tokens=leg.cache_write,
        )
    return total

def catalog() -> list[dict[str, Any]]:
    configured = {
        settings.llm_model_opus,
        settings.llm_model_sonnet,
        settings.llm_model_haiku,
    }
    return [
        {
            "id": m.id,
            "label": m.label,
            "input_per_mtok": m.input_per_token * _PER_MTOK,
            "output_per_mtok": m.output_per_token * _PER_MTOK,
            "cache_read_mult": m.cache_read_mult,
            "cache_write_mult": CACHE_WRITE_MULT,
            "tokenizer_factor": m.tokenizer_factor,
            "long_context_threshold": m.long_context_threshold,
            "long_context_input_per_mtok": (
                m.long_context_input_per_token * _PER_MTOK
                if m.long_context_input_per_token is not None
                else None
            ),
            "long_context_output_per_mtok": (
                m.long_context_output_per_token * _PER_MTOK
                if m.long_context_output_per_token is not None
                else None
            ),
            # Resolve each configured id through the catalog rather than
            # prefix-matching: "claude-opus-5-5".startswith("claude-opus-5")
            # is True, which labelled Opus 5 as running at Opus 5.5's rates.
            "is_configured": any(
                (p := price_for(c)) is not None and p.id == m.id for c in configured
            ),
        }
        for m in MODEL_CATALOG
    ]
