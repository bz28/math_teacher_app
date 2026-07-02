import asyncio, json, pathlib
from tests.harness.browser import find_cached_chromium
from playwright.async_api import async_playwright
ROOT = pathlib.Path("/Users/benzhao/Documents/Veradic/math_teacher_app/docs/design")
tok = json.load(open("/tmp/teacher_login.json")); st = json.load(open("/tmp/demo_state.json"))
URL = f"http://localhost:3000/school/teacher/courses/{st['course_id']}/homework/{st['hw_id']}/review"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, executable_path=find_cached_chromium(), args=["--disable-gpu"])
        ctx = await b.new_context(viewport={"width": 1200, "height": 2200}, device_scale_factor=2)
        await ctx.add_init_script(
            f"try{{localStorage.setItem('veradic_access_token',{json.dumps(tok['access_token'])});"
            f"localStorage.setItem('veradic_refresh_token',{json.dumps(tok['refresh_token'])});}}catch(e){{}}")
        pg = await ctx.new_page()
        await pg.goto(URL, wait_until="networkidle", timeout=60000)
        await pg.wait_for_selector(".katex", timeout=30000)
        # Expand the solution: click the "SHOW SOLUTION" toggle
        btn = pg.locator("text=/SHOW SOLUTION/i").first
        await btn.click()
        await pg.wait_for_timeout(1500)
        pmx = await pg.evaluate("() => document.body.innerHTML.match(/pmatrix|\\\\begin/g) ? 'has-latex-src' : 'render-only'")
        katex = await pg.evaluate("() => document.querySelectorAll('.katex').length")
        # count matrix arrays actually rendered by katex
        arrays = await pg.evaluate("() => document.querySelectorAll('.katex .mord.mtable, .katex .arraycolsep, .katex .col-align-c').length")
        print("katex nodes:", katex, "| matrix-render nodes:", arrays)
        await pg.screenshot(path=str(ROOT / "shot_01b_matrix_solution.png"), full_page=True)
        print("saved shot_01b_matrix_solution.png")
        await b.close()
asyncio.run(main())
