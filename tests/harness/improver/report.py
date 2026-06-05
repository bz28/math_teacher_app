"""Self-contained HTML report for one improver scan.

The ranked proposals up top (what Ben approves from), then every scanned
surface with its full-page screenshot, load time, console errors, and
detector/judge hits — so the proposals can be checked against the evidence
they came from. Screenshots are base64-embedded so the file is portable (same
trick as tests/harness/report.py).
"""

from __future__ import annotations

import base64
import html
from pathlib import Path

from tests.harness.improver.proposals import Proposal
from tests.harness.improver.types import DetectorHit, PageObservation

_SEV_COLOR = {"high": "#b03a2e", "medium": "#b9770e", "low": "#7a7768"}


def _thumb(png: bytes | None) -> str:
    if png is None:
        return '<div class="noimg">no screenshot</div>'
    b64 = base64.b64encode(png).decode("ascii")
    return f'<img loading="lazy" src="data:image/png;base64,{b64}">'


def _hit_row(h: DetectorHit) -> str:
    color = _SEV_COLOR.get(h.severity, "#7a7768")
    tag = "JUDGE" if h.source == "judge" else "DET"
    return (
        f'<li><span class="sev" style="color:{color}">{h.severity.upper()}</span> '
        f'<span class="dtag">{tag}</span> <b>{html.escape(h.detector)}</b> — '
        f"{html.escape(h.detail)}"
        + (f' <span class="where">[{html.escape(h.evidence)}]</span>' if h.evidence else "")
        + "</li>"
    )


def _proposal_row(i: int, p: Proposal) -> str:
    color = _SEV_COLOR.get(p.severity, "#7a7768")
    return (
        f"<tr><td>{i}</td>"
        f"<td><b>{html.escape(p.title)}</b><br><span class='muted'>{html.escape(p.change)}</span></td>"
        f"<td>{html.escape(p.surface_key)}</td>"
        f"<td>{html.escape(p.category)}</td>"
        f"<td style='color:{color}'>{p.severity}</td>"
        f"<td>{p.est_size}</td><td>{p.confidence:.2f}</td>"
        f"<td><b>{p.score:.2f}</b></td>"
        f"<td><code>{p.id}</code></td></tr>"
    )


def _surface_card(o: PageObservation) -> str:
    status = (
        f'<span style="color:#b03a2e">FAILED: {html.escape(o.error or "")}</span>'
        if not o.ok else f'<span style="color:#1f7a3d">ok</span> · {round(o.load_ms or 0)}ms'
    )
    errors = "".join(
        f"<li><span class='sev' style='color:#b03a2e'>CONSOLE</span> {html.escape(e[:200])}</li>"
        for e in o.console_errors[:5]
    )
    hits = "".join(_hit_row(h) for h in o.hits)
    body = (errors + hits) or "<li class='muted'>no issues detected</li>"
    return (
        f'<div class="surface"><div class="meta"><h3>{html.escape(o.surface_key)}</h3>'
        f'<div class="url">{html.escape(o.url)} · {html.escape(o.role)} · {status}</div>'
        f"<ul>{body}</ul></div>"
        f'<div class="shot">{_thumb(o.png)}</div></div>'
    )


async def persist_scan_summary(
    *, scanned: int, total: int, hits: int, proposals: int,
    report_html: str, cost_usd: float | None, mode: str, summary_db_url: str,
) -> bool:
    """Write one run-summary row per scan into the MAIN app DB so the admin
    'Harness Runs' tab shows the improver alongside the harness (cost, proposal
    count, surfaces, embedded report). Best-effort — never fails the scan."""
    try:
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        from api.models.harness_run import HarnessRun

        engine = create_async_engine(summary_db_url)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                s.add(HarnessRun(
                    probe="improver", mode=mode,
                    items_generated=proposals, captures=scanned,
                    det_pass=scanned, det_total=total,
                    judge_count=0, judge_mean=None,
                    cost_usd=cost_usd, passed=scanned > 0,
                    note=f"{proposals} proposals · {scanned}/{total} surfaces loaded · {hits} hits",
                    report_html=report_html,
                ))
                await s.commit()
        finally:
            await engine.dispose()
        return True
    except Exception:  # noqa: BLE001 — observability, never fatal
        return False


def proposals_digest_md(proposals: list[dict[str, object]]) -> str:
    """Explain-simple bullet plan for the proposals you approve from — readable
    on a phone, one card each. Used as the GitHub-issue body in the cloud loop."""
    if not proposals:
        return "_No open proposals._"

    def _score(d: dict[str, object]) -> float:
        v = d.get("score", 0)
        return float(v) if isinstance(v, (int, float)) else 0.0

    cards = []
    for p in sorted(proposals, key=_score, reverse=True):
        cards.append(
            f"### {p.get('title')}  `{p.get('id')}`\n"
            f"- **What:** {p.get('change')}\n"
            f"- **Why:** {p.get('rationale')}\n"
            f"- **Size / risk:** {p.get('est_size')} · {p.get('category')} · {p.get('severity')} "
            f"(confidence {p.get('confidence')})\n"
            f"- **Approve:** comment `approve {p.get('id')}`  ·  **Skip:** `reject {p.get('id')}`"
        )
    return "\n\n".join(cards)


def write_scan_report(
    observations: list[PageObservation],
    proposals: list[Proposal],
    out_path: Path,
) -> Path:
    """Render the scan to a portable HTML file and return its path."""
    scanned = sum(1 for o in observations if o.ok)
    total_hits = sum(len(o.hits) for o in observations)
    prop_rows = "".join(_proposal_row(i, p) for i, p in enumerate(proposals, 1))
    surface_cards = "".join(_surface_card(o) for o in observations)
    page = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Improver scan</title><style>
 body {{ font-family:system-ui,sans-serif; background:#fbf9f2; color:#1a1a17;
        padding:24px; max-width:1200px; margin:auto; }}
 h1 {{ font-size:21px; }} h3 {{ font-size:14px; margin:0 0 4px; }}
 .muted {{ color:#7a7768; }} code {{ font-size:11px; color:#7a7768; }}
 table {{ width:100%; border-collapse:collapse; font-size:13px; margin-bottom:28px; }}
 th,td {{ text-align:left; padding:7px 9px; border-bottom:1px solid #e2ddcf; vertical-align:top; }}
 th {{ font-size:11px; text-transform:uppercase; color:#7a7768; }}
 .surface {{ display:flex; gap:16px; padding:14px 0; border-bottom:1px solid #e2ddcf; }}
 .meta {{ flex:1; }} .url {{ font-size:11px; color:#7a7768; margin-bottom:8px; word-break:break-all; }}
 .shot {{ width:340px; flex:none; }} .shot img {{ width:100%; border:1px solid #e2ddcf; border-radius:6px; }}
 .noimg {{ width:100%; height:120px; display:flex; align-items:center; justify-content:center;
          color:#b03a2e; border:1px dashed #d8d2c2; border-radius:6px; }}
 ul {{ margin:0; padding-left:0; list-style:none; font-size:12px; }} li {{ padding:2px 0; }}
 .sev {{ font-weight:700; font-size:10px; }} .dtag {{ font-size:9px; color:#a59;
        background:#f0ebdd; padding:1px 4px; border-radius:3px; }}
 .where {{ color:#7a7768; }}
</style></head><body>
<h1>Improver scan</h1>
<p class="muted">{scanned}/{len(observations)} surfaces loaded · {total_hits} hits · {len(proposals)} proposals</p>
<h2>Proposals (ranked)</h2>
<table><thead><tr><th>#</th><th>Title / change</th><th>Surface</th><th>Cat</th>
<th>Sev</th><th>Size</th><th>Conf</th><th>Score</th><th>Id</th></tr></thead>
<tbody>{prop_rows or '<tr><td colspan=9 class=muted>no proposals</td></tr>'}</tbody></table>
<h2>Scanned surfaces</h2>
{surface_cards}
</body></html>"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(page)
    return out_path
