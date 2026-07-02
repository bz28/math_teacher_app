"""Drive the REAL web UI, screenshot each generated problem as it renders
(KaTeX + figures) on the homework review page. Reads tokens + ids from state."""
import asyncio, json, pathlib, sys
from tests.harness.browser import find_cached_chromium
from playwright.async_api import async_playwright

ROOT = pathlib.Path("/Users/benzhao/Documents/Veradic/math_teacher_app/docs/design")
tok = json.load(open("/tmp/teacher_login.json"))
st = json.load(open("/tmp/demo_state.json"))
ACCESS, REFRESH = tok["access_token"], tok["refresh_token"]
CID, HW = st["course_id"], st["hw_id"]
WEB = "http://localhost:3000"
URL = f"{WEB}/school/teacher/courses/{CID}/homework/{HW}/review"

async def main():
    exe = find_cached_chromium()
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, executable_path=exe, args=["--disable-gpu"])
        ctx = await b.new_context(viewport={"width": 1200, "height": 1600}, device_scale_factor=2)
        await ctx.add_init_script(
            f"try{{localStorage.setItem('veradic_access_token',{json.dumps(ACCESS)});"
            f"localStorage.setItem('veradic_refresh_token',{json.dumps(REFRESH)});}}catch(e){{}}")
        pg = await ctx.new_page()
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(URL, wait_until="networkidle", timeout=60000)
        try:
            await pg.wait_for_selector(".katex", timeout=30000)
        except Exception as e:
            print("no katex:", e)
        await pg.wait_for_timeout(1500)

        labels = ["01_matrix_system", "02_right_triangle", "03_multistep_linear"]
        for i, name in enumerate(labels):
            await pg.wait_for_timeout(800)
            # counter / title text for sanity
            heading = await pg.evaluate("() => document.body.innerText.slice(0,600)")
            out = ROOT / f"shot_{name}.png"
            await pg.screenshot(path=str(out), full_page=True)
            print(f"--- shot {i} {name} -> {out.name}")
            print("   visible heading snippet:", " | ".join(
                [l for l in heading.split(chr(10)) if l.strip()][:6]))
            svg_count = await pg.evaluate("() => document.querySelectorAll('svg').length")
            katex_count = await pg.evaluate("() => document.querySelectorAll('.katex').length")
            print(f"   svgs={svg_count} katex={katex_count}")
            if i < len(labels) - 1:
                await pg.keyboard.press("s")  # Skip -> next queue item
                await pg.wait_for_timeout(1200)
        print("CONSOLE ERRORS:", errors[:10] if errors else "none")
        await b.close()

asyncio.run(main())
