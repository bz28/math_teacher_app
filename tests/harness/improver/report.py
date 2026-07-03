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

# A list of serialized proposals (to_dict(Proposal)); named for the digest's
# per-app grouping helpers.
_Props = list[dict[str, object]]


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


async def deliver_harness_run(
    fields: dict[str, object], *,
    summary_db_url: str = "", summary_url: str = "", token: str = "",
) -> bool:
    """Write one HarnessRun row to the admin 'Harness Runs' tab, via whichever
    transport is configured. Two paths: an HTTPS POST to the prod ingest
    endpoint (``summary_url`` — used by CI, which can't reach prod Postgres) or
    a direct DB insert (``summary_db_url`` — local runs). ``summary_url`` wins
    when both are set. Best-effort — returns False, never raises."""
    try:
        if summary_url:
            import httpx

            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(
                    summary_url, json=fields, headers={"X-Harness-Token": token},
                )
            if r.status_code >= 300:
                # Surface, don't swallow: a silent failure here is the exact
                # "invisible runs" symptom this path exists to fix. The most
                # likely cause is PROD_API_BASE missing the /v1 prefix (→ 404).
                print(f"[harness-run] ingest POST {summary_url} -> {r.status_code}; "
                      f"row not recorded (check PROD_API_BASE includes /v1 + token)")
                return False
            return True
        if summary_db_url:
            from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

            from api.models.harness_run import HarnessRun

            engine = create_async_engine(summary_db_url)
            try:
                async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                    s.add(HarnessRun(**fields))
                    await s.commit()
            finally:
                await engine.dispose()
            return True
        return False
    except Exception as e:  # noqa: BLE001 — observability, never fatal
        if summary_url:
            print(f"[harness-run] ingest delivery to {summary_url} failed: {e!r}")
        return False


async def persist_scan_summary(
    *, scanned: int, total: int, hits: int, proposals: int,
    report_html: str, cost_usd: float | None, mode: str,
    summary_db_url: str = "", summary_url: str = "", token: str = "",
) -> bool:
    """One run-summary row per scan so the admin 'Harness Runs' tab shows the
    improver's ideation (cost, proposal count, surfaces, embedded report)."""
    return await deliver_harness_run(
        {
            "probe": "improver", "mode": mode,
            "items_generated": proposals, "captures": scanned,
            "det_pass": scanned, "det_total": total,
            "judge_count": 0, "judge_mean": None,
            "cost_usd": cost_usd, "passed": scanned > 0,
            "note": f"{proposals} proposals · {scanned}/{total} surfaces loaded · {hits} hits",
            "report_html": report_html,
        },
        summary_db_url=summary_db_url, summary_url=summary_url, token=token,
    )


async def persist_execute_summary(
    *, proposal_id: str, title: str, pr_url: str,
    summary_db_url: str = "", summary_url: str = "", token: str = "",
) -> bool:
    """One row per executed (implemented) proposal so the tab shows fixes, not
    just ideation. Plan-billed, so the dollar cost is unknown (null)."""
    opened = bool(pr_url)
    outcome = f"PR: {html.escape(pr_url)}" if opened else "No PR opened — see the run log."
    report = (
        f"<pre>Executed proposal {html.escape(proposal_id)}\n"
        f"{html.escape(title)}\n\n{outcome}</pre>"
    )
    return await deliver_harness_run(
        {
            "probe": "improver", "mode": "execute",
            "items_generated": 1, "captures": 0,
            "det_pass": 1 if opened else 0, "det_total": 1,
            "judge_count": 0, "judge_mean": None,
            "cost_usd": None, "passed": opened,
            "note": f"executed {proposal_id} · {pr_url or 'no PR opened'} · {title}",
            "report_html": report,
        },
        summary_db_url=summary_db_url, summary_url=summary_url, token=token,
    )


# Primary grouping is by APP (derived from the surface_key prefix), so a person
# reads the backlog one product surface at a time. "Product ideas" (feature-gap
# ideation, surface_key "product") leads because features are scarce/high-intent
# — surface them above the bulk defect sections. Then Web, Admin, Demo, Mobile,
# then a catch-all "Other" for keys we don't recognise.
_APP_SECTIONS: list[tuple[str, str]] = [
    ("product", "Product ideas"),
    ("web", "Web"), ("admin", "Admin"), ("demo", "Demo"), ("mobile", "Mobile"),
]
_APP_LABELS: dict[str, str] = {**dict(_APP_SECTIONS), "other": "Other"}
_SEV_ORDER = {"high": 0, "medium": 1, "low": 2}
# At most this many proposals shown as full cards per app section — EXCEPT Highs,
# which are never capped away (the cap only trims Medium/Low into a collapsed
# "+ N more" list). So a section with 8 Highs shows all 8.
_PER_APP_CAP = 5
# Mobile isn't scanned yet (Expo SecureStore token injection is still pending),
# so its section is a standing placeholder rather than proposals.
_MOBILE_PLACEHOLDER = "🔴 Not yet scanned — Expo auth injection pending"


def _app_of(surface_key: str) -> str:
    """Map a surface_key (possibly a comma-joined multi-surface list) to its app
    bucket via the first segment's prefix: ``product*``→product (feature-gap
    ideas), ``web.*``→web, ``admin.*``→admin, ``demo.*``→demo,
    ``mobile.*``→mobile; anything else → other."""
    first = str(surface_key or "").split(",")[0].strip()
    prefix = first.split(".", 1)[0].lower()
    return prefix if prefix in {"product", "web", "admin", "demo", "mobile"} else "other"


def proposals_digest_md(
    proposals: list[dict[str, object]],
    max_chars: int | None = None,
    *,
    screenshot_ids: set[str] | None = None,
    screenshot_base_url: str = "",
) -> str:
    """Explain-simple plan for the proposals you approve from — readable on a
    phone, grouped by APP then priority. Used as the GitHub-issue body.

    Layout: one section per app (Product ideas, Web, Admin, Demo, Mobile, Other)
    — "Product ideas" (feature-gap ideation) leads. Within a
    section, proposals sort by severity (High→Medium→Low), then by score. Each
    section shows at most `_PER_APP_CAP` full cards — but never caps away a High;
    the cap only trims Medium/Low, which collapse into a "+ N more" one-liner
    list so nothing is lost. Mobile is a standing placeholder (not yet scanned).

    `max_chars` bounds the output for the GitHub-issue body (hard-capped at
    65,536 chars; a large carried-forward backlog blows past it and the
    create/edit is silently rejected). Over budget → the full cards degrade to
    one-liners (highest-priority first keep their cards) so EVERY shown proposal
    stays visible and approvable. Pass None (the default) to never bound it.

    `screenshot_ids` + `screenshot_base_url`: when a proposal's id is in the set,
    embed its surface screenshot (`<base_url>/<id>.png`) inside its full card so
    the issue shows the evidence. Only full cards get images (one-liners don't);
    if no screenshot exists for a proposal, its card just omits the image.
    """
    if not proposals:
        return "_No open proposals._"
    shots = screenshot_ids or set()
    base_url = screenshot_base_url.rstrip("/")

    def _score(d: dict[str, object]) -> float:
        v = d.get("score", 0)
        return float(v) if isinstance(v, (int, float)) else 0.0

    def _sev(d: dict[str, object]) -> str:
        return str(d.get("severity") or "low").lower()

    # Proposal prose routinely names HTML tags (e.g. "wrap each <li> in a <ul>").
    # GitHub renders issue bodies as markdown-with-HTML, so an unescaped <ul>
    # gets parsed as a real (empty) list element and the words vanish. Escape
    # the free-text fields; the id sits inside `backticks` (literal) and the
    # enum/number fields can't contain markup.
    def esc(v: object) -> str:
        return html.escape(str(v), quote=False)

    def _img(p: dict[str, object]) -> str:
        pid = str(p.get("id") or "")
        if base_url and pid in shots:
            return f"\n\n![]({base_url}/{pid}.png)"
        return ""

    def _card(p: dict[str, object]) -> str:
        return (
            f"### {esc(p.get('title'))}  `{p.get('id')}`\n"
            f"- **What:** {esc(p.get('change'))}\n"
            f"- **Why:** {esc(p.get('rationale'))}\n"
            f"- **Size / risk:** {p.get('est_size')} · {p.get('category')} · {p.get('severity')} "
            f"(confidence {p.get('confidence')})\n"
            f"- **Approve:** comment `approve {p.get('id')}`  ·  **Skip:** `reject {p.get('id')}`"
            + _img(p)
        )

    def _line(p: dict[str, object]) -> str:
        # One scannable line — id, severity, title — small enough that the whole
        # backlog fits the issue-body budget. Detail is in the run artifacts.
        return f"- `{p.get('id')}` **{p.get('severity')}** — {esc(p.get('title'))}"

    # --- group by app, split each into shown cards + trimmed one-liners ---
    by_app: dict[str, list[dict[str, object]]] = {}
    for p in proposals:
        by_app.setdefault(_app_of(str(p.get("surface_key") or "")), []).append(p)

    def _split(props: _Props) -> tuple[_Props, _Props]:
        ordered = sorted(props, key=lambda d: (_SEV_ORDER.get(_sev(d), 3), -_score(d)))
        highs = [p for p in ordered if _sev(p) == "high"]
        rest = [p for p in ordered if _sev(p) != "high"]
        slots = max(0, _PER_APP_CAP - len(highs))  # Highs never capped
        return highs + rest[:slots], rest[slots:]

    # (app, label, shown, trimmed, placeholder?) in display order.
    sections: list[tuple[str, str, _Props, _Props, bool]] = []
    for app, label in _APP_SECTIONS:
        props = by_app.get(app)
        # Mobile isn't scanned yet, so with no proposals it's a standing
        # placeholder. But the moment mobile scanning lands and real mobile
        # proposals exist, render them like any other section — otherwise they'd
        # be counted in the census/header yet be invisible and un-approvable.
        if app == "mobile" and not props:
            sections.append((app, label, [], [], True))
            continue
        if not props:
            continue
        shown, trimmed = _split(props)
        sections.append((app, label, shown, trimmed, False))
    if by_app.get("other"):
        shown, trimmed = _split(by_app["other"])
        sections.append(("other", "Other", shown, trimmed, False))

    census = " · ".join(
        f"{len(by_app[a])} {_APP_LABELS[a]}"
        for a in [*(x for x, _ in _APP_SECTIONS), "other"]
        if by_app.get(a)
    )

    def _render(header: str, card_ids: set[str] | None) -> str:
        out = [header]
        for app, label, shown, trimmed, placeholder in sections:
            if placeholder:
                out.append(f"## {label}\n\n{_MOBILE_PLACEHOLDER}")
                continue
            blocks = [
                _card(p) if (card_ids is None or str(p.get("id")) in card_ids) else _line(p)
                for p in shown
            ]
            section = f"## {label} ({len(shown) + len(trimmed)})\n\n" + "\n\n".join(blocks)
            if trimmed:
                tail = "\n".join(_line(p) for p in trimmed)
                section += f"\n\n_+ {len(trimmed)} more (Medium/Low):_\n{tail}"
            out.append(section)
        return "\n\n".join(out)

    verbose = _render(f"**{len(proposals)} open** — {census}", None)
    if max_chars is None or len(verbose) <= max_chars:
        return verbose

    # Over budget: degrade shown cards to one-liners, keeping the highest-
    # priority ones (across all apps) as full cards for as long as the budget
    # allows. Trimmed items are already one-liners. Full What/Why for any item
    # lives in the scan run artifacts or `improve show <id>`.
    header = (
        f"**{len(proposals)} open** — {census}\n\n"
        "_Top proposals shown in full; the rest are one-liners so the whole "
        "backlog fits one issue. Full What/Why for any item: the latest scan "
        "run's artifacts or `improve show <id>`. Comment `approve <id>` / "
        "`reject <id>`._"
    )
    shown_all = [p for _, _, shown, _, _ in sections for p in shown]
    card_ids: set[str] = set()
    cur = len(_render(header, card_ids))  # all shown as one-liners (floor)
    # Upgrade line→card in global priority order; each swap changes only that
    # one block's length by exactly len(card) - len(line).
    for p in sorted(shown_all, key=lambda d: (_SEV_ORDER.get(_sev(d), 3), -_score(d))):
        delta = len(_card(p)) - len(_line(p))
        if cur + delta <= max_chars:
            card_ids.add(str(p.get("id")))
            cur += delta
    body = _render(header, card_ids)
    if len(body) > max_chars:  # pathological titles — final guard
        footer = "\n\n_…truncated — full list in the scan run artifacts._"
        body = body[: max(0, max_chars - len(footer))].rstrip() + footer
    return body


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
