"""Record the chaptered teacher walkthrough video.

    python -m scripts.walkthrough.record [--out DIR] [--voiceover DIR] ...

One run: reseed a fresh world → synthesize narration (or load the human
voice-over) → drive the real app in Chromium while recording → cut the
chapters, insert title cards, lay the narration at each beat's timestamp →
walkthrough.mp4, walkthrough.vtt, chapters.json, poster.jpg.

Needs the local stack (web + API) running against the walkthrough DB, plus
ffmpeg/ffprobe and macOS `say`. Makes no LLM calls: AI routes are blocked
at the network layer and the run fails if anything tries one.
See README.md.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
import wave
from array import array
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from playwright.async_api import Locator, Page, async_playwright

from scripts.walkthrough.script import CHAPTERS, PRONOUNCE, Beat, Chapter
from tests.harness.browser import find_cached_chromium

HERE = Path(__file__).resolve().parent
W, H = 1440, 900               # viewport == recording size
OUT_W, OUT_H = 1280, 720       # final video
FPS = 25
SR = 48000
CARD_SECONDS = 1.5
TAIL = 0.4                     # hold after each beat's narration ends
CHAPTER_TAIL = 0.5             # extra hold before cutting to the next card
MAX_BYTES = 25 * 1024 * 1024
BG = "#F7F5F0"                 # the app's --color-bg; pillarbox + card fades
PRIMARY = "#0E5238"
TZ = "America/New_York"
SYNC_COLOR = "#FF00FF"

# Every route that can call an LLM. Non-GET requests matching this are
# aborted and the run fails: the recording must cost $0.
AI_ROUTES = re.compile(
    r"question-bank/(generate|upload)|suggest-units|/chat(/|$)|generate-similar|"
    r"/regenerate|graph-checklist/rewrite|grade-pending|grade-now|/regrade|"
    r"clone-as-practice|practice-problems|integrity/.*/turn"
)

DEFAULT_OUT = Path(tempfile.gettempdir()) / "veradic-walkthrough"


# ── small utilities ─────────────────────────────────────────────────────

def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


def ffprobe_duration(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "default=nw=1:nk=1", str(path)]).stdout.decode().strip()
    return float(out)


def log(msg: str) -> None:
    print(msg, flush=True)


# ── narration ───────────────────────────────────────────────────────────

@dataclass
class Clip:
    path: Path
    duration: float
    source: str  # "tts" | "voiceover"


VO_EXTS = (".wav", ".m4a", ".mp3", ".aif", ".aiff", ".caf")


def tts_text(text: str) -> str:
    for k, v in PRONOUNCE.items():
        text = re.sub(rf"\b{re.escape(k)}\b", v, text)
    return text


def build_narration(beats: list[Beat], work: Path, voice: str, rate: int,
                    voiceover: Path | None) -> dict[str, Clip]:
    """One 48 kHz mono WAV per beat: the human take if the voice-over folder
    has `<beat id>.<ext>`, otherwise macOS `say` (cached by text+voice)."""
    cache = work / "tts-cache"
    cache.mkdir(parents=True, exist_ok=True)
    clips: dict[str, Clip] = {}
    missing_vo: list[str] = []
    for b in beats:
        src, source = None, "tts"
        if voiceover:
            src = next((voiceover / f"{b.id}{e}" for e in VO_EXTS
                        if (voiceover / f"{b.id}{e}").exists()), None)
            if src:
                source = "voiceover"
            else:
                missing_vo.append(b.id)
        if src is None:
            text = tts_text(b.narration)
            key = hashlib.sha1(f"{voice}|{rate}|{text}".encode()).hexdigest()[:16]
            src = cache / f"{key}.aiff"
            if not src.exists():
                run(["say", "-v", voice, "-r", str(rate), "-o", str(src), text])
        out = work / "narration" / f"{b.id}.wav"
        out.parent.mkdir(parents=True, exist_ok=True)
        # Trim the leading/trailing silence `say` (and most takes) carry, so
        # the beat timing follows the words.
        af = ("silenceremove=start_periods=1:start_threshold=-50dB,"
              "areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse")
        if source == "voiceover":
            af += ",loudnorm=I=-18:TP=-2:LRA=11"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-af", af,
             "-ac", "1", "-ar", str(SR), "-sample_fmt", "s16", str(out)])
        clips[b.id] = Clip(out, ffprobe_duration(out), source)
    if voiceover and missing_vo:
        log(f"  ! voice-over missing for {len(missing_vo)} beat(s), using TTS: "
            + ", ".join(missing_vo))
    return clips


# ── fixtures and title cards (rendered HTML → PNG) ──────────────────────

FONTS = ("<link rel='stylesheet' href='https://fonts.googleapis.com/css2?"
         "family=Instrument+Serif&family=Inter:wght@400;600&display=block'>")

FIXTURE_HTML = """<!doctype html><html><head>{fonts}<style>
body {{ margin:0; background:#fff; font-family:Inter, Helvetica, sans-serif; color:#1f1d18; }}
.page {{ width:1100px; height:1400px; box-sizing:border-box; padding:90px 100px; }}
.kicker {{ letter-spacing:.2em; font-size:18px; color:{primary}; font-weight:600; }}
h1 {{ font-family:'Instrument Serif', Georgia, serif; font-weight:400; font-size:76px; margin:14px 0 6px; }}
h2 {{ font-size:26px; margin:46px 0 12px; }}
p, li {{ font-size:24px; line-height:1.55; }}
.box {{ border-left:6px solid {primary}; background:#f3f7f4; padding:18px 26px; margin:24px 0; font-size:26px; }}
svg {{ display:block; margin:26px 0; }}
</style></head><body><div class='page'>
<div class='kicker'>CHAPTER 4</div><h1>Graphing Lines</h1>
<p>Every line on the coordinate plane can be written in <b>slope-intercept form</b>:</p>
<div class='box'><i>y</i> = <i>m</i><i>x</i> + <i>b</i> &nbsp;&nbsp; where <i>m</i> is the slope and <i>b</i> is the <i>y</i>-intercept.</div>
<h2>4.1 &nbsp;Slope from two points</h2>
<p>The slope measures how steep a line is: the change in <i>y</i> divided by the change in <i>x</i>.</p>
<div class='box'><i>m</i> = (<i>y</i>₂ − <i>y</i>₁) / (<i>x</i>₂ − <i>x</i>₁)</div>
<svg width='520' height='360' viewBox='0 0 520 360'>
 <g stroke='#d9d4c7'>{grid}</g>
 <line x1='0' y1='300' x2='520' y2='300' stroke='#555' stroke-width='2'/>
 <line x1='60' y1='0' x2='60' y2='360' stroke='#555' stroke-width='2'/>
 <line x1='20' y1='340' x2='500' y2='20' stroke='{primary}' stroke-width='4'/>
 <circle cx='120' cy='260' r='7' fill='{primary}'/><circle cx='300' cy='140' r='7' fill='{primary}'/>
 <text x='132' y='286' font-size='20'>(2, 1)</text><text x='312' y='166' font-size='20'>(8, 5)</text>
</svg>
<h2>Try it</h2>
<ol><li>Find the slope through (1, 3) and (5, 11).</li>
<li>Graph <i>y</i> = −2<i>x</i> + 4. Where does it cross the <i>y</i>-axis?</li>
<li>Write the equation of the line through (0, −1) with slope ½.</li></ol>
</div></body></html>"""

CARD_HTML = """<!doctype html><html><head>{fonts}<style>
html, body {{ margin:0; width:{w}px; height:{h}px; background:{bg}; overflow:hidden; }}
body {{ display:flex; flex-direction:column; justify-content:center; padding:0 120px; box-sizing:border-box;
       font-family:Inter, Helvetica, sans-serif; color:#1f1d18; }}
.kicker {{ font-size:18px; letter-spacing:.28em; font-weight:600; color:{primary}; }}
h1 {{ font-family:'Instrument Serif', Georgia, serif; font-weight:400; font-size:92px; line-height:1.02; margin:18px 0 0; }}
.rule {{ width:84px; height:4px; background:{primary}; margin-top:34px; border-radius:2px; }}
.brand {{ position:absolute; left:120px; bottom:56px; font-size:17px; color:#6b665c; letter-spacing:.04em; }}
.brand b {{ color:{primary}; }}
</style></head><body>
<div class='kicker'>CHAPTER {n} OF {total}</div><h1>{title}</h1><div class='rule'></div>
<div class='brand'><b>Veradic</b> &nbsp;·&nbsp; Teacher walkthrough</div>
</body></html>"""


async def render_assets(browser, work: Path) -> tuple[dict[str, Path], list[Path]]:
    fixtures_dir = work / "fixtures"
    cards_dir = work / "cards"
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    cards_dir.mkdir(parents=True, exist_ok=True)
    page = await browser.new_page(viewport={"width": 1100, "height": 1400})
    grid = "".join(f"<line x1='{x}' y1='0' x2='{x}' y2='360'/>" for x in range(0, 521, 30)) + \
        "".join(f"<line x1='0' y1='{y}' x2='520' y2='{y}'/>" for y in range(0, 361, 30))

    async def set_html(html: str) -> None:
        try:
            await page.set_content(html, wait_until="networkidle", timeout=8000)
        except Exception:  # noqa: BLE001 — offline: fall back to system fonts
            await page.set_content(html.replace(FONTS, ""), wait_until="load")
        await page.evaluate("document.fonts.ready")

    await set_html(FIXTURE_HTML.format(fonts=FONTS, primary=PRIMARY, grid=grid))
    fixture = fixtures_dir / "chapter-4-graphing-lines.png"
    await page.screenshot(path=str(fixture))

    await page.set_viewport_size({"width": OUT_W, "height": OUT_H})
    cards = []
    for n, ch in enumerate(CHAPTERS, 1):
        await set_html(CARD_HTML.format(
            fonts=FONTS, w=OUT_W, h=OUT_H, bg=BG, primary=PRIMARY, n=n,
            total=len(CHAPTERS), title=ch.title))
        p = cards_dir / f"{n:02d}-{ch.id}.png"
        await page.screenshot(path=str(p))
        cards.append(p)
    await page.close()
    return {fixture.name: fixture}, cards


# ── driving the app ─────────────────────────────────────────────────────

class Driver:
    """Interprets the script's actions with a visible, smoothly moving
    cursor. Every element is found by role/text (see script.py)."""

    def __init__(self, page: Page, web: str, ctx: dict, fixtures: dict[str, Path], work: Path):
        self.page = page
        self.web = web
        self.ctx = ctx
        self.fixtures = fixtures
        self.work = work
        self.x, self.y = W / 2, H / 2

    def fmt(self, s: str) -> str:
        return s.format(**self.ctx)

    def locate(self, target: str) -> Locator:
        scope: Page | Locator = self.page
        for seg in self.fmt(target).split(" >> "):
            idx = None
            m = re.match(r"^(.*)@(\d+)$", seg, re.S)
            if m:
                seg, idx = m.group(1), int(m.group(2))
            m = re.match(r"^([a-z]+)([:=])(.*)$", seg, re.S)
            kind, exact, val = (m.group(1), m.group(2) == "=", m.group(3)) if m else (seg, False, None)
            if kind == "text":
                loc = scope.get_by_text(val, exact=exact)
            elif kind == "placeholder":
                loc = scope.get_by_placeholder(val, exact=exact)
            elif kind == "label":
                loc = scope.get_by_label(val, exact=exact)
            elif kind == "css":
                loc = scope.locator(val)
            elif val is None:
                loc = scope.get_by_role(kind)
            else:
                loc = scope.get_by_role(kind, name=val, exact=exact)
            loc = loc.filter(visible=True)
            scope = loc.nth(idx) if idx is not None else loc.first
        return scope  # type: ignore[return-value]

    async def glide(self, x: float, y: float) -> None:
        x0, y0 = self.x, self.y
        dist = math.hypot(x - x0, y - y0)
        if dist < 2:
            return
        dur = min(0.95, 0.3 + dist / 1900)
        n = max(10, int(dur * 60))
        t_start = time.monotonic()
        for i in range(1, n + 1):
            t = i / n
            e = 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2
            await self.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e)
            lag = t_start + dur * t - time.monotonic()
            if lag > 0:
                await asyncio.sleep(lag)
        self.x, self.y = x, y

    async def settle_box(self, loc: Locator) -> dict:
        prev = None
        for _ in range(20):
            box = await loc.bounding_box()
            if box and prev and abs(box["y"] - prev["y"]) < 0.5 and abs(box["x"] - prev["x"]) < 0.5:
                return box
            prev = box
            await asyncio.sleep(0.08)
        assert prev, "element has no box"
        return prev

    async def reveal(self, target: str) -> tuple[Locator, float, float]:
        """Make sure the element is on screen (smooth scroll if not) and
        return a point to aim at."""
        loc = self.locate(target)
        await loc.wait_for(state="visible", timeout=20000)
        box = await self.settle_box(loc)
        # Leave room for sticky headers and the editor's bottom bar.
        if box["y"] < 60 or box["y"] + min(box["height"], 200) > H - 100:
            await loc.evaluate("el => el.scrollIntoView({behavior: 'smooth', block: 'center'})")
            await asyncio.sleep(0.25)
            box = await self.settle_box(loc)
        x = box["x"] + min(box["width"] / 2, 160)
        y = box["y"] + min(box["height"] / 2, 60)
        return loc, x, y

    async def press_at(self, x: float, y: float) -> None:
        await asyncio.sleep(0.12)
        await self.page.mouse.down()
        await asyncio.sleep(0.07)
        await self.page.mouse.up()

    async def do(self, action: tuple) -> None:
        kind, *args = action
        page = self.page
        if kind == "goto":
            await page.goto(self.web + self.fmt(args[0]), wait_until="load")
            try:
                await page.wait_for_load_state("networkidle", timeout=6000)
            except Exception:  # noqa: BLE001 — pages that poll never go idle
                pass
            await asyncio.sleep(0.6)
        elif kind == "wait":
            await asyncio.sleep(args[0])
        elif kind == "wait_for":
            await self.locate(args[0]).wait_for(state="visible", timeout=20000)
            await asyncio.sleep(0.3)
        elif kind == "hover":
            _, x, y = await self.reveal(args[0])
            await self.glide(x, y)
            await asyncio.sleep(args[1])
        elif kind == "click":
            _, x, y = await self.reveal(args[0])
            await self.glide(x, y)
            await self.press_at(x, y)
            await asyncio.sleep(args[1])
        elif kind in ("type", "fill"):
            loc, x, y = await self.reveal(args[0])
            await self.glide(x, y)
            await self.press_at(x, y)
            text = self.fmt(args[1])
            if kind == "type":
                await page.keyboard.type(text, delay=45)
            else:
                await loc.fill(text)
            await asyncio.sleep(args[2])
        elif kind == "select":
            loc, x, y = await self.reveal(args[0])
            await self.glide(x, y)
            await page.evaluate("([x, y]) => window.__wtRipple(x, y)", [x, y])
            opt = args[1]
            await asyncio.sleep(0.2)
            if isinstance(opt, int):
                await loc.select_option(index=opt)
            else:
                await loc.select_option(label=self.fmt(opt))
            await asyncio.sleep(args[2])
        elif kind == "scroll":
            loc = self.locate(args[0])
            await loc.wait_for(state="visible", timeout=20000)
            await loc.evaluate("el => el.scrollIntoView({behavior: 'smooth', block: 'center'})")
            await asyncio.sleep(0.3)
            await self.settle_box(loc)
            await asyncio.sleep(args[1])
        elif kind == "scroll_by":
            steps = 14
            for _ in range(steps):
                await page.mouse.wheel(0, args[0] / steps)
                await asyncio.sleep(0.03)
            await asyncio.sleep(0.4 + args[1])
        elif kind == "upload":
            _, x, y = await self.reveal(args[0])
            await self.glide(x, y)
            async with page.expect_file_chooser() as fc:
                await self.press_at(x, y)
            await (await fc.value).set_files(str(self.fixtures[args[1]]))
            await asyncio.sleep(args[2])
        elif kind == "download":
            _, x, y = await self.reveal(args[0])
            await self.glide(x, y)
            async with page.expect_download() as dl:
                await self.press_at(x, y)
            d = await dl.value
            await d.save_as(str(self.work / "downloads" / d.suggested_filename))
            await asyncio.sleep(args[1])
        elif kind == "press":
            await page.keyboard.press(args[0])
            await asyncio.sleep(args[1])
        else:
            raise ValueError(f"unknown action {kind!r}")


@dataclass
class BeatTiming:
    id: str
    chapter: str
    wall_start: float
    wall_end: float
    narration: float
    overrun: float


@dataclass
class ChapterTiming:
    id: str
    title: str
    wall_start: float
    wall_end: float
    beats: list[BeatTiming] = field(default_factory=list)


async def record(args, ids: dict, clips: dict[str, Clip], work: Path,
                 chapters: list[Chapter]) -> tuple[Path, list[float], list[ChapterTiming], dict]:
    web = args.web.rstrip("/")
    api = args.api.rstrip("/")
    issues: dict = {"blocked_ai_requests": [], "console_errors": [], "http_errors": []}
    raw_dir = work / "raw"
    shutil.rmtree(raw_dir, ignore_errors=True)
    (work / "downloads").mkdir(parents=True, exist_ok=True)

    due = (datetime.now(ZoneInfo(TZ)) + timedelta(days=5)).replace(hour=23, minute=59)
    ctx_vars = {**ids, "due_local": due.strftime("%Y-%m-%dT%H:%M")}

    async with async_playwright() as pw:
        kw = {"headless": not args.headed}
        exe = find_cached_chromium()
        if exe:
            kw["executable_path"] = exe
        browser = await pw.chromium.launch(**kw)
        fixtures, cards = await render_assets(browser, work)

        context = await browser.new_context(
            viewport={"width": W, "height": H}, device_scale_factor=1,
            record_video_dir=str(raw_dir), record_video_size={"width": W, "height": H},
            locale="en-US", timezone_id=TZ, color_scheme="light", accept_downloads=True,
        )
        await context.grant_permissions(["clipboard-read", "clipboard-write"], origin=web)
        await context.add_init_script(
            "try { localStorage.setItem('veradic_access_token', %s);"
            " localStorage.setItem('veradic_refresh_token', %s); } catch (e) {}"
            % (json.dumps(ids["teacher_token"]), json.dumps(ids["teacher_refresh"]))
        )
        await context.add_init_script((HERE / "overlay.js").read_text())

        current = {"beat": "setup"}

        async def guard(route):
            r = route.request
            if r.method != "GET" and AI_ROUTES.search(r.url):
                issues["blocked_ai_requests"].append(f"{current['beat']}: {r.method} {r.url}")
                await route.abort()
                return
            await route.fallback()

        await context.route(f"{api}/**", guard)
        if args.photo_origin and args.photo_origin.rstrip("/") != api:
            # The API signs local-dev photo URLs with PHOTO_LOCAL_BASE_URL
            # (default :8000). Serve them from *this* API instead.
            origin = args.photo_origin.rstrip("/")

            async def reroute(route):
                resp = await route.fetch(url=route.request.url.replace(origin, api, 1))
                await route.fulfill(response=resp)

            await context.route(f"{origin}/v1/dev/photos/**", reroute)

        page = await context.new_page()
        page.on("console", lambda m: issues["console_errors"].append(
            f"{current['beat']}: {m.text[:300]}") if m.type == "error" else None)
        page.on("pageerror", lambda e: issues["console_errors"].append(
            f"{current['beat']}: pageerror {str(e)[:300]}"))
        page.on("response", lambda r: issues["http_errors"].append(
            f"{current['beat']}: {r.status} {r.request.method} {r.url}")
            if r.status >= 400 and r.url.startswith(api) else None)

        drv = Driver(page, web, ctx_vars, fixtures, work)
        await drv.do(("goto", "/school/teacher"))
        await page.mouse.move(drv.x, drv.y)

        # Sync marks: a full-screen colour block whose first frame we find in
        # the raw video, pinning wall-clock time to video time. Chromium's
        # screencast can fall seconds behind the wall clock when the machine
        # is busy, so we flash one before and after every chapter (both
        # moments are trimmed out of the cut) and retime each chapter
        # between its own pair.
        marks: list[float] = []

        async def mark() -> None:
            await page.evaluate(
                "(c) => new Promise(r => { window.__wtSync(c);"
                " requestAnimationFrame(() => requestAnimationFrame(r)); })", SYNC_COLOR)
            marks.append(time.monotonic())
            await asyncio.sleep(0.6)
            await page.evaluate("() => window.__wtSync(null)")
            await asyncio.sleep(0.5)

        await asyncio.sleep(0.8)
        await mark()

        timings: list[ChapterTiming] = []
        for ch in chapters:
            current["beat"] = f"{ch.id}/setup"
            log(f"  ▸ {ch.id}")
            for a in ch.setup:
                await drv.do(a)
            await asyncio.sleep(0.4)
            await mark()
            ct = ChapterTiming(ch.id, ch.title, time.monotonic(), 0.0)
            for b in ch.beats:
                current["beat"] = b.id
                t0 = time.monotonic()
                try:
                    for a in b.actions:
                        await drv.do(a)
                except Exception as e:
                    shot = work / f"FAILED-{b.id}.png"
                    await page.screenshot(path=str(shot))
                    raise RuntimeError(f"beat {b.id}: {a!r} failed ({e}); see {shot}") from e
                busy = time.monotonic() - t0
                hold = clips[b.id].duration + TAIL - busy
                if hold > 0:
                    await asyncio.sleep(hold)
                ct.beats.append(BeatTiming(b.id, ch.id, t0, time.monotonic(),
                                           clips[b.id].duration, max(0.0, -hold)))
            await asyncio.sleep(CHAPTER_TAIL)
            ct.wall_end = time.monotonic()
            timings.append(ct)
            await mark()

        current["beat"] = "teardown"
        video = page.video
        await context.close()
        raw = Path(await video.path())
        await browser.close()
    return raw, marks, timings, {"issues": issues, "cards": cards}


# ── post-production ─────────────────────────────────────────────────────

def find_syncs(raw: Path) -> list[float]:
    """Video time of the first frame of every run of the sync colour."""
    rate = 50
    proc = run(["ffmpeg", "-v", "error", "-i", str(raw), "-vf",
                f"fps={rate}:start_time=0,crop=40:40:{W // 2 - 20}:{H // 2 - 20},scale=1:1",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
    data = proc.stdout
    found, inside = [], False
    for i in range(len(data) // 3):
        r, g, b = data[3 * i: 3 * i + 3]
        hit = r > 200 and g < 90 and b > 200
        if hit and not inside:
            found.append(i / rate)
        inside = hit
    return found


def encode_clip(cmd_in: list[str], vf: str, out: Path, seconds: float) -> float:
    run(["ffmpeg", "-y", "-v", "error", *cmd_in, "-t", f"{seconds:.3f}", "-vf", vf,
         "-r", str(FPS), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "12",
         "-pix_fmt", "yuv420p", str(out)])
    return ffprobe_duration(out)


def wrap_cues(text: str, start: float, dur: float, width: int = 42) -> list[tuple[float, float, str]]:
    """Split a beat's narration into ≤2-line cues of ≤~42 chars, timed in
    proportion to their length. Prefers sentence boundaries."""
    sentences = re.split(r"(?<=[.!?:])\s+", text.strip())
    chunks: list[list[str]] = []
    for s in sentences:
        lines = textwrap.wrap(s, width=width)
        # Fold a short trailing sentence into the previous cue when it fits.
        if chunks and len(chunks[-1]) == 1 and len(lines) == 1:
            chunks[-1].append(lines[0])
            continue
        for i in range(0, len(lines), 2):
            pair = lines[i:i + 2]
            if len(pair) == 1 and i > 0 and len(chunks[-1]) == 2 and len(pair[0]) < 12:
                # Avoid an orphaned word: rebalance into the previous cue.
                merged = textwrap.wrap(" ".join(chunks[-1] + pair), width=width + 6)
                if len(merged) <= 2:
                    chunks[-1] = merged
                    continue
            chunks.append(pair)
    total = sum(len(" ".join(c)) for c in chunks) or 1
    cues, t = [], start
    for c in chunks:
        d = dur * len(" ".join(c)) / total
        cues.append((t, t + d, "\n".join(c)))
        t += d
    return cues


def ts(t: float) -> str:
    h, rem = divmod(max(t, 0.0), 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def mix_audio(placements: list[tuple[float, Path]], total: float, out: Path) -> None:
    n = int(math.ceil(total * SR))
    buf = array("h", bytes(2 * n))
    for t, path in placements:
        with wave.open(str(path)) as w:
            assert w.getframerate() == SR and w.getnchannels() == 1 and w.getsampwidth() == 2
            samples = array("h", w.readframes(w.getnframes()))
        off = int(round(t * SR))
        end = min(n, off + len(samples))
        # Beats never overlap (each holds until its narration ends), so a
        # clip lands on silence: copy it in rather than mix sample by sample.
        buf[off:end] = samples[: end - off]
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(buf.tobytes())


def produce(raw: Path, marks: list[float], timings: list[ChapterTiming], cards: list[Path],
            clips: dict[str, Clip], out: Path, work: Path) -> dict:
    v_marks = find_syncs(raw)
    if len(v_marks) != len(marks):
        raise RuntimeError(f"expected {len(marks)} sync marks in the raw video, found {len(v_marks)}")
    anchors = list(zip(marks, v_marks))
    drift = [round((v - v_marks[0]) - (w - marks[0]), 2) for w, v in anchors]

    def vt(wall: float) -> float:
        """Wall clock → raw video time, piecewise-linear between marks."""
        for (w0, v0), (w1, v1) in zip(anchors, anchors[1:]):
            if wall <= w1:
                return v0 + (wall - w0) * (v1 - v0) / (w1 - w0)
        w0, v0 = anchors[-1]
        return v0 + (wall - w0)

    seg_dir = work / "segments"
    shutil.rmtree(seg_dir, ignore_errors=True)
    seg_dir.mkdir(parents=True)
    pad_w = round(W * OUT_H / H / 2) * 2  # 1152
    fit = (f"scale={pad_w}:{OUT_H}:flags=lanczos,"
           f"pad={OUT_W}:{OUT_H}:{(OUT_W - pad_w) // 2}:0:color=0x{BG[1:]}")
    fade_c = f"0x{BG[1:]}"

    beats_by_id = {b.id: b for c in CHAPTERS for b in c.beats}
    card_by_chapter = {p.stem.split("-", 1)[1]: p for p in cards}
    concat_list, placements, chapters_json, cues, beat_rows = [], [], [], [], []
    cursor = 0.0
    for idx, ct in enumerate(timings):
        card_clip = seg_dir / f"{idx:02d}a-card.mp4"
        card_len = encode_clip(
            ["-loop", "1", "-i", str(card_by_chapter[ct.id])],
            f"fps={FPS},format=yuv420p,fade=t=in:st=0:d=0.3:color={fade_c},"
            f"fade=t=out:st={CARD_SECONDS - 0.3}:d=0.3:color={fade_c}",
            card_clip, CARD_SECONDS)
        chapters_json.append({"id": ct.id, "title": ct.title, "start": round(cursor, 2)})
        cursor += card_len

        seg_clip = seg_dir / f"{idx:02d}b-{ct.id}.mp4"
        # Stretch or squeeze the chapter's raw span to its wall-clock length,
        # so the narration (placed on wall-clock time) stays on its action.
        start_v, end_v = vt(ct.wall_start), vt(ct.wall_end)
        wall_len = ct.wall_end - ct.wall_start
        k = wall_len / (end_v - start_v)
        seg_len = encode_clip(["-ss", f"{start_v:.3f}", "-i", str(raw)],
                              f"setpts=(PTS-STARTPTS)*{k:.6f},{fit}", seg_clip, wall_len)
        for bt in ct.beats:
            t = cursor + (bt.wall_start - ct.wall_start)
            placements.append((t, clips[bt.id].path))
            cues += [(a, b, txt, bt.id) for a, b, txt in
                     wrap_cues(beats_by_id[bt.id].narration, t, clips[bt.id].duration)]
            beat_rows.append({"id": bt.id, "chapter": ct.id, "start": round(t, 2),
                              "narration": round(bt.narration, 2),
                              "length": round(bt.wall_end - bt.wall_start, 2),
                              "actions_overran_by": round(bt.overrun, 2),
                              "voice": clips[bt.id].source})
        cursor += seg_len
        concat_list += [card_clip, seg_clip]

    total = cursor
    listing = seg_dir / "concat.txt"
    listing.write_text("".join(f"file '{p}'\n" for p in concat_list))
    joined = work / "joined.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
         "-c", "copy", str(joined)])
    audio = work / "narration.wav"
    mix_audio(placements, total, audio)

    final = out / "walkthrough.mp4"
    for crf in (22, 24, 26, 28, 30, 32):
        run(["ffmpeg", "-y", "-v", "error", "-i", str(joined), "-i", str(audio),
             "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow",
             "-crf", str(crf), "-pix_fmt", "yuv420p", "-r", str(FPS), "-g", str(FPS * 10),
             "-c:a", "aac", "-b:a", "128k", "-ar", str(SR), "-ac", "1",
             "-movflags", "+faststart", "-t", f"{total:.3f}", str(final)])
        size = final.stat().st_size
        log(f"  encoded at CRF {crf}: {size / 1e6:.1f} MB")
        if size <= MAX_BYTES:
            break

    vtt = ["WEBVTT", ""]
    for n, (a, b, txt, bid) in enumerate(cues, 1):
        vtt += [f"{bid}-{n}", f"{ts(a)} --> {ts(b)}", txt, ""]
    (out / "walkthrough.vtt").write_text("\n".join(vtt))

    chap_vtt = ["WEBVTT", ""]
    for i, c in enumerate(chapters_json):
        end = chapters_json[i + 1]["start"] if i + 1 < len(chapters_json) else total
        chap_vtt += [c["id"], f"{ts(c['start'])} --> {ts(end)}", c["title"], ""]
    (out / "chapters.vtt").write_text("\n".join(chap_vtt))
    (out / "chapters.json").write_text(json.dumps(chapters_json, indent=2) + "\n")

    # Poster: a settled moment in the welcome chapter (the queue beat).
    poster_t = next((r["start"] + 3.0 for r in beat_rows if r["id"] == "welcome.queue"),
                    chapters_json[0]["start"] + CARD_SECONDS + 2.0)
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{poster_t:.2f}", "-i", str(final),
         "-frames:v", "1", "-q:v", "2", str(out / "poster.jpg")])

    return {"duration": round(total, 2), "bytes": final.stat().st_size, "crf": crf,
            "sync_drift": drift, "beats": beat_rows, "chapters": chapters_json}


def qa_frames(final: Path, beats: list[dict], out_dir: Path) -> None:
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)
    for r in beats:
        for tag, t in (("a", r["start"] + 0.8), ("b", r["start"] + max(1.0, r["length"] - 0.6))):
            run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", str(final),
                 "-frames:v", "1", "-q:v", "3", str(out_dir / f"{r['id']}-{tag}.jpg")])


# ── entry point ─────────────────────────────────────────────────────────

def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path(os.environ.get("WALKTHROUGH_OUT", DEFAULT_OUT)),
                    help="output folder (default: $WALKTHROUGH_OUT or %(default)s)")
    ap.add_argument("--web", default=os.environ.get("WEB_BASE", "http://localhost:3010"))
    ap.add_argument("--api", default=os.environ.get("API_BASE", "http://localhost:8010"),
                    help="API origin the web app talks to (no /v1)")
    ap.add_argument("--photo-origin", default="http://localhost:8000",
                    help="origin the API puts in local photo URLs (PHOTO_LOCAL_BASE_URL); "
                         "rerouted to --api so no request reaches it")
    ap.add_argument("--voice", default="Samantha", help="macOS `say` voice")
    ap.add_argument("--rate", type=int, default=168, help="`say` words per minute")
    ap.add_argument("--voiceover", type=Path, default=None,
                    help="folder of human takes named <beat id>.wav (or .m4a/.mp3/.aiff); "
                         "missing beats fall back to TTS")
    ap.add_argument("--only", default="", help="comma-separated chapter ids (iteration only: "
                    "chapters build on each other's state)")
    ap.add_argument("--no-seed", action="store_true",
                    help="reuse the world from the last run (work/world.json)")
    ap.add_argument("--qa", action="store_true", help="also extract two frames per beat to out/qa/")
    ap.add_argument("--headed", action="store_true")
    return ap.parse_args(argv)


async def main(argv=None) -> int:
    args = parse_args(argv)
    out: Path = args.out.resolve()
    work = out / "work"
    work.mkdir(parents=True, exist_ok=True)
    for tool in ("ffmpeg", "ffprobe", "say"):
        if not shutil.which(tool):
            log(f"missing tool: {tool}")
            return 2

    chapters = CHAPTERS
    if args.only:
        wanted = {c.strip() for c in args.only.split(",")}
        chapters = [c for c in CHAPTERS if c.id in wanted]

    world = work / "world.json"
    if args.no_seed and world.exists():
        ids = json.loads(world.read_text())
        log("Reusing the seeded world from the last run")
    else:
        from scripts.walkthrough.seed import seed
        log("Seeding a fresh walkthrough world …")
        ids = await seed()
        world.write_text(json.dumps(ids, indent=2))

    beats = [b for c in chapters for b in c.beats]
    log(f"Narration for {len(beats)} beats ({'voice-over: ' + str(args.voiceover) if args.voiceover else 'TTS ' + args.voice}) …")
    clips = build_narration(beats, work, args.voice, args.rate, args.voiceover)
    log(f"  {sum(c.duration for c in clips.values()) / 60:.1f} min of narration")

    log("Recording …")
    raw, marks, timings, extra = await record(args, ids, clips, work, chapters)
    issues = extra["issues"]
    if issues["blocked_ai_requests"]:
        log("!! The run tried to call the AI — blocked, and the run is failed:")
        for r in issues["blocked_ai_requests"]:
            log(f"   {r}")
        return 1

    log("Cutting and encoding …")
    report = produce(raw, marks, timings, extra["cards"], clips, out, work)
    report["issues"] = issues
    (out / "timeline.json").write_text(json.dumps(report, indent=2) + "\n")
    if args.qa:
        qa_frames(out / "walkthrough.mp4", report["beats"], out / "qa")

    over = [b for b in report["beats"] if b["actions_overran_by"] > 0.5]
    log(f"\nDone: {out / 'walkthrough.mp4'}  {report['bytes'] / 1e6:.1f} MB  "
        f"{report['duration'] / 60:.1f} min  (CRF {report['crf']})")
    for c in report["chapters"]:
        log(f"  {c['start']:7.2f}s  {c['id']}")
    log(f"Screencast lag at each sync mark (s): {report['sync_drift']}")
    if over:
        log("Beats whose actions outlasted the narration (silent stretch):")
        for b in over:
            log(f"  {b['id']}: +{b['actions_overran_by']}s")
    if issues["console_errors"] or issues["http_errors"]:
        log(f"App errors seen while recording: {len(issues['console_errors'])} console, "
            f"{len(issues['http_errors'])} HTTP (see timeline.json)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
