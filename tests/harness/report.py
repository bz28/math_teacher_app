"""Reporter — render a RunResult as a self-contained HTML page.

Embeds the card screenshots inline (base64) so the report is a single file
you can open anywhere: per-item deterministic checks, per-card judge scores +
rationale, page-level flags (overflow / console errors), and total $ spent.
"""

from __future__ import annotations

import base64
import html
from pathlib import Path

from tests.harness.runner import RunResult


def _png_data_uri(png: bytes | None) -> str:
    if not png:
        return ""
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _badge(ok: bool, label: str) -> str:
    cls = "ok" if ok else "err"
    return f'<span class="badge {cls}">{html.escape(label)}</span>'


def write_report(result: RunResult, out_path: Path) -> Path:
    det_passed = sum(1 for it in result.items if it.passed)
    judged = [c for c in result.captures if c.judge is not None]
    mean_judge = (
        round(sum(c.judge.mean for c in judged if c.judge) / len(judged), 2)
        if judged else None
    )
    cost = "$0.00 (replay)" if result.cost_usd == 0 else (
        f"${result.cost_usd:.4f}" if result.cost_usd is not None else "n/a"
    )

    item_cells = []
    for it in result.items:
        rows = "".join(
            f"<li>{_badge(c.passed, 'PASS' if c.passed else 'FAIL')} "
            f"{html.escape(c.name)}"
            f"{(' — ' + html.escape(c.detail)) if c.detail else ''}</li>"
            for c in it.checks
        )
        item_cells.append(
            f'<div class="cell"><b>{html.escape(it.item.label)}</b>'
            f'<div class="q">{html.escape(it.item.problem_text[:160])}</div>'
            f'<ul class="checks">{rows}</ul></div>'
        )

    card_cells = []
    for c in result.captures:
        cap = c.capture
        flags = []
        if cap.overflow:
            flags.append(_badge(False, "OVERFLOW"))
        if cap.console_errors:
            flags.append(_badge(False, f"{len(cap.console_errors)} console err"))
        if not flags:
            flags.append(_badge(True, "page clean"))
        if c.judge:
            score_rows = " ".join(
                f'<span class="score">{html.escape(d)}: <b>{v}</b>/5</span>'
                for d, v in c.judge.scores.items()
            )
            judge_html = (
                f'<div class="scores">{score_rows} '
                f'<span class="score mean">mean {c.judge.mean}/5</span></div>'
                f'<div class="rationale">{html.escape(c.judge.rationale)}</div>'
            )
        else:
            judge_html = '<div class="rationale">(not sampled for judging)</div>'
        img = _png_data_uri(cap.png)
        img_html = f'<img src="{img}"/>' if img else '<div class="noimg">no screenshot</div>'
        card_cells.append(
            f'<div class="cell"><b>{html.escape(cap.label)}</b> '
            f'<small>({html.escape(cap.role)})</small> {" ".join(flags)}'
            f'<div class="shot">{img_html}</div>{judge_html}</div>'
        )

    page = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Harness report — {html.escape(result.probe_name)}</title>
<style>
  body {{ background:#fbf9f2; color:#1a1a17; font-family:system-ui,sans-serif; margin:0; padding:24px; }}
  h1 {{ font-size:20px; margin:0 0 4px; }}
  .summary {{ color:#3a382f; margin-bottom:20px; font-size:14px; }}
  .summary b {{ color:#1a1a17; }}
  h2 {{ font-size:15px; margin:22px 0 10px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:14px; }}
  .cell {{ border:1px solid #e2ddcf; border-radius:10px; padding:12px; background:#fffdf8; }}
  .q {{ font-size:12px; color:#7a7768; margin:4px 0 8px; }}
  ul.checks {{ margin:6px 0 0; padding-left:0; list-style:none; font-size:12px; line-height:1.7; }}
  .badge {{ font-size:10px; padding:1px 6px; border-radius:6px; }}
  .badge.ok {{ background:#1f7a3d; color:#fff; }} .badge.err {{ background:#b03a2e; color:#fff; }}
  .shot {{ margin:8px 0; text-align:center; }} .shot img {{ max-width:100%; border:1px solid #eee; border-radius:6px; }}
  .noimg {{ color:#b03a2e; font-size:12px; padding:16px; }}
  .scores {{ font-size:12px; }} .score {{ display:inline-block; margin-right:8px; }}
  .score.mean {{ font-weight:bold; }} .rationale {{ font-size:12px; color:#3a382f; margin-top:4px; font-style:italic; }}
</style></head><body>
<h1>Harness report — {html.escape(result.probe_name)} <small>({html.escape(result.mode)} mode)</small></h1>
<div class="summary">
  <b>{len(result.items)}</b> figure items · deterministic checks passed
  <b>{det_passed}/{len(result.items)}</b> · judged <b>{len(judged)}</b> cards
  {f'· mean judge <b>{mean_judge}/5</b>' if mean_judge is not None else ''}
  · spent <b>{cost}</b><br><small>{html.escape(result.note)}</small>
</div>
<h2>Deterministic checks (per generated item)</h2>
<div class="grid">{''.join(item_cells) or '<i>no items</i>'}</div>
<h2>Rendered cards + judge (teacher view)</h2>
<div class="grid">{''.join(card_cells) or '<i>no cards captured</i>'}</div>
</body></html>"""

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(page)
    return out_path
