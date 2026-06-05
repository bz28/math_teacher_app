"""Reporter — render a RunResult as a self-contained HTML page.

One block per generated question: its deterministic-check summary, then its
rendered views side by side — the Question as it appears on the page, and its
Worked solution (steps + per-step figures) — each with the judge's score.
Screenshots are embedded inline (base64) so the report is a single file.
"""

from __future__ import annotations

import base64
import html
from pathlib import Path
from typing import Any

from tests.harness.runner import CaptureResult, ItemResult, RunResult
from tests.harness.types import JudgeScore


def _png_data_uri(png: bytes | None) -> str:
    if not png:
        return ""
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _badge(ok: bool, label: str) -> str:
    cls = "ok" if ok else "err"
    return f'<span class="badge {cls}">{html.escape(label)}</span>'


def _prompt_block(prompt: str) -> str:
    """The 'Prompt tested' panel — what steered this run's generation. Empty
    string when no prompt was recorded (older rows)."""
    if not prompt:
        return ""
    return (
        '<div class="summary"><b>Prompt tested:</b><br>'
        f"<small>{html.escape(prompt)}</small></div>"
    )


_VIEW_TITLE = {
    "question": "Question — as the page renders it",
    "solution": "Worked solution — steps + per-step figures",
}


def _det_summary(it: ItemResult) -> str:
    failed = [c for c in it.checks if not c.passed]
    if not failed:
        return _badge(True, f"{len(it.checks)}/{len(it.checks)} checks passed")
    rows = "".join(
        f"<li>{_badge(False, 'FAIL')} {html.escape(c.name)}"
        f"{(' — ' + html.escape(c.detail)) if c.detail else ''}</li>"
        for c in failed
    )
    return (
        f'<span class="badge err">{len(failed)} of {len(it.checks)} failed</span>'
        f'<ul class="checks">{rows}</ul>'
    )


def _solution_html(steps: list[Any] | None) -> str:
    """Render the worked solution the AI produced (each step's title +
    description) so a reader can SEE what the correctness judge scored, not
    just the score. Empty when there are no steps."""
    if not steps:
        return ""
    rows = []
    for i, s in enumerate(steps):
        if not isinstance(s, dict):
            continue
        title = html.escape(str(s.get("title") or ""))
        desc = html.escape(str(s.get("description") or ""))
        head = f"Step {i + 1}{' · ' + title if title else ''}"
        rows.append(f"<li><b>{head}</b><br>{desc}</li>")
    if not rows:
        return ""
    return (
        '<details class="solution" open><summary>Worked solution</summary>'
        f'<ol class="soln">{"".join(rows)}</ol></details>'
    )


def _correctness_html(j: JudgeScore | None) -> str:
    """Render the text judge's per-problem correctness scores (well_posed,
    answer_correct, steps_valid) + rationale, or a 'not judged' note."""
    if j is None:
        return '<div class="rationale">(correctness not judged)</div>'
    scores = " · ".join(f"{html.escape(d)} {v}/5" for d, v in j.scores.items())
    flag = _badge(j.mean >= 4, f"correctness {j.mean}/5")
    return (
        f'<div class="correctness">{flag}'
        f'<div class="scores">{scores}</div>'
        f'<div class="rationale">{html.escape(j.rationale)}</div></div>'
    )


def _view(c: CaptureResult) -> str:
    cap = c.capture
    flags = []
    if cap.overflow:
        flags.append(_badge(False, "figure overflow"))
    if cap.console_errors:
        flags.append(_badge(False, f"{len(cap.console_errors)} console err"))
    if not flags:
        flags.append(_badge(True, "page clean"))
    if c.judge:
        flags.append(_badge(c.judge.mean >= 4, f"judge {c.judge.mean}/5"))
        scores = " · ".join(
            f"{html.escape(d)} {v}" for d, v in c.judge.scores.items()
        )
        judge_html = (
            f'<div class="scores">{scores}</div>'
            f'<div class="rationale">{html.escape(c.judge.rationale)}</div>'
        )
    else:
        judge_html = '<div class="rationale">(not sampled for judging)</div>'
    img = _png_data_uri(cap.png)
    img_html = (
        f'<img src="{img}"/>' if img else '<div class="noimg">no screenshot</div>'
    )
    title = _VIEW_TITLE.get(cap.kind, cap.kind)
    return (
        f'<figure class="view"><figcaption>{html.escape(title)} '
        f'{" ".join(flags)}</figcaption>'
        f'<div class="shot">{img_html}</div>{judge_html}</figure>'
    )


def write_report(result: RunResult, out_path: Path) -> Path:
    det_passed = sum(1 for it in result.items if it.passed)
    judge_means = [c.judge.mean for c in result.captures if c.judge is not None]
    judge_means += [j.mean for j in result.item_judgments if j is not None]
    mean_judge = (
        round(sum(judge_means) / len(judge_means), 2) if judge_means else None
    )
    has_correctness = any(j is not None for j in result.item_judgments)
    cost = "$0.00 (replay)" if result.cost_usd == 0 else (
        f"${result.cost_usd:.4f}" if result.cost_usd is not None else "n/a"
    )

    caps_by_item: dict[int, list[CaptureResult]] = {}
    for c in result.captures:
        caps_by_item.setdefault(c.capture.item_index, []).append(c)

    blocks = []
    for i, it in enumerate(result.items):
        views = sorted(
            caps_by_item.get(i, []),
            key=lambda c: 0 if c.capture.kind == "question" else 1,
        )
        parts: list[str] = []
        if views:
            parts.append(f'<div class="views">{"".join(_view(c) for c in views)}</div>')
        if has_correctness:
            j = result.item_judgments[i] if i < len(result.item_judgments) else None
            ans = it.item.raw.get("final_answer") or "(none)"
            parts.append(_solution_html(it.item.raw.get("solution_steps")))
            parts.append(
                f'<div class="answer"><b>Stated answer:</b> {html.escape(str(ans))}</div>'
            )
            parts.append(_correctness_html(j))
        if not parts:
            parts.append('<div class="noimg">no page capture for this question</div>')
        blocks.append(
            f'<section class="qblock">'
            f'<div class="qhead"><span class="qnum">Question {i + 1}</span>'
            f'<span class="qtitle">{html.escape(it.item.label)}</span>'
            f'<span class="qdet">{_det_summary(it)}</span></div>'
            f'<div class="qtext">{html.escape(it.item.problem_text[:220])}</div>'
            f'{"".join(parts)}'
            f'</section>'
        )

    page = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Harness report — {html.escape(result.probe_name)}</title>
<style>
  body {{ background:#fbf9f2; color:#1a1a17; font-family:system-ui,sans-serif; margin:0; padding:24px; }}
  h1 {{ font-size:20px; margin:0 0 4px; }}
  .summary {{ color:#3a382f; margin-bottom:22px; font-size:14px; }}
  .summary b {{ color:#1a1a17; }}
  .qblock {{ border:1px solid #e2ddcf; border-radius:12px; padding:16px; margin-bottom:16px; background:#fffdf8; }}
  .qhead {{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }}
  .qnum {{ font-weight:bold; font-size:15px; }}
  .qtitle {{ color:#3a382f; font-size:14px; }}
  .qdet {{ margin-left:auto; }}
  .qtext {{ font-size:12px; color:#7a7768; margin:6px 0 12px; }}
  .views {{ display:flex; gap:16px; flex-wrap:wrap; }}
  .view {{ flex:1; min-width:320px; margin:0; border:1px solid #efe9d9;
           border-radius:8px; padding:10px; background:#fff; }}
  figcaption {{ font-size:12px; font-weight:600; color:#3a382f;
                margin-bottom:6px; display:flex; gap:6px; align-items:center;
                flex-wrap:wrap; }}
  .badge {{ font-size:10px; padding:1px 6px; border-radius:6px; }}
  .badge.ok {{ background:#1f7a3d; color:#fff; }} .badge.err {{ background:#b03a2e; color:#fff; }}
  ul.checks {{ margin:6px 0 0; padding-left:16px; font-size:12px; line-height:1.6; }}
  .shot {{ text-align:center; }} .shot img {{ max-width:100%; border:1px solid #eee; border-radius:6px; }}
  .noimg {{ color:#b03a2e; font-size:12px; padding:14px; }}
  .scores {{ font-size:11px; color:#555; margin-top:6px; }}
  .rationale {{ font-size:12px; color:#3a382f; margin-top:3px; font-style:italic; }}
  .answer {{ font-size:12px; color:#3a382f; margin-top:8px; }}
  .solution {{ margin-top:8px; font-size:12px; color:#3a382f; }}
  .solution summary {{ cursor:pointer; font-weight:600; }}
  ol.soln {{ margin:6px 0 0; padding-left:18px; line-height:1.6; }}
  ol.soln li {{ margin-bottom:6px; }}
  .correctness {{ margin-top:8px; padding:8px 10px; border:1px solid #efe9d9;
                  border-radius:8px; background:#fff; }}
</style></head><body>
<h1>Harness report — {html.escape(result.probe_name)} <small>({html.escape(result.mode)} mode)</small></h1>
<div class="summary">
  <b>{len(result.items)}</b> questions generated · deterministic checks passed
  <b>{det_passed}/{len(result.items)}</b>
  {f'· judge mean <b>{mean_judge}/5</b> over {len(judge_means)} judged' if mean_judge is not None else ''}
  · spent <b>{cost}</b><br>
  <small>{html.escape(result.note)}</small>
</div>
{_prompt_block(result.prompt)}
{''.join(blocks) or '<i>no questions generated</i>'}
</body></html>"""

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(page)
    return out_path
