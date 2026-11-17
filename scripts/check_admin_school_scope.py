"""Browser checks for the admin console's school scope.

Pins behaviour a backend test can't see:
  1. a value left under the retired storage key does not scope anything
     (first load after deploy is All schools);
  2. when GET /admin/schools fails, a saved school is still named as a
     school (never as "All schools") and can be cleared;
  3. /schools/:id sets the scope even when that list fails;
  4. the school page's LLM-calls links carry the school explicitly;
  5. ?school= / ?school_id= deep links scope LLM calls / Audit log;
  6. a school created after the console loaded can still be scoped;
  7. a non-UUID /schools/:id never becomes the stored scope.

Check 6 creates a school in the target DB on every run.

Prerequisites: an API on a scratch DB seeded by
`scripts.seed_admin_school_scope`, and the dashboard pointed at it
(VITE_API_URL). Then:
    DASHBOARD_URL=http://localhost:5173 API_URL=http://localhost:8000/v1 \
        python -m scripts.check_admin_school_scope

Prints PASS/FAIL per check and exits 1 if any fail.
"""

import json
import os
import sys
import urllib.request
from typing import Any

from playwright.sync_api import sync_playwright

BASE = os.environ.get("DASHBOARD_URL", "http://localhost:5173")
API = os.environ.get("API_URL", "http://localhost:8000/v1")
SCOPE_KEY = "veradic_admin_scope"
RETIRED_KEY = "veradic_admin_school"


def _get_json(url: str, body: dict[str, Any] | None = None, token: str | None = None) -> Any:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    return json.load(urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers)))


tok = _get_json(f"{API}/auth/login", {"email": "admin@veradiclocal.com", "password": "admin"})
schools = _get_json(f"{API}/admin/schools", token=tok["access_token"])["schools"]
LINCOLN = next(s["id"] for s in schools if s["name"].startswith("Lincoln"))
RIVER = next(s["id"] for s in schools if s["name"].startswith("Riverside"))

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def fresh(b: Any, storage: dict[str, str], fail_schools: bool = False) -> tuple[Any, list[str]]:
    """A signed-in page whose localStorage starts as exactly `storage`."""
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    init = {
        "admin_access_token": tok["access_token"],
        "admin_refresh_token": tok["refresh_token"],
        **storage,
    }
    # Seed once per tab, so later navigations see what the app wrote.
    ctx.add_init_script(
        "(() => { if (sessionStorage.getItem('__seeded')) return;"
        " sessionStorage.setItem('__seeded', '1'); localStorage.clear();"
        f" const s = {json.dumps(init)};"
        " for (const k in s) localStorage.setItem(k, s[k]); })()"
    )
    if fail_schools:
        ctx.route("**/v1/admin/schools", lambda r: r.fulfill(status=500, body="boom"))
    p = ctx.new_page()
    reqs: list[str] = []
    p.on("request", lambda r: reqs.append(r.url) if "/v1/admin/" in r.url else None)
    return p, reqs


def last(reqs: list[str], frag: str) -> str:
    hits = [u for u in reqs if frag in u]
    return hits[-1] if hits else ""


def visit(p: Any, path: str, wait: int = 2500) -> None:
    p.goto(f"{BASE}{path}")
    p.wait_for_timeout(wait)


def spa_go(p: Any, path: str, wait: int = 2500) -> None:
    """Client-side navigation — no reload, so in-memory state (the
    console's school list) survives, as it does when an operator clicks."""
    p.evaluate(
        "(path) => { history.pushState({}, '', path);"
        " dispatchEvent(new PopStateEvent('popstate')); }",
        path,
    )
    p.wait_for_timeout(wait)


def scoped_to(reqs: list[str], frag: str, school: str | None) -> tuple[bool, str]:
    """Was the latest `frag` request scoped to `school` (None = unscoped)?"""
    url = last(reqs, frag)
    if school is None:
        return bool(url) and "school_id" not in url, url
    return f"school_id={school}" in url, url


def stored(p: Any, key: str = SCOPE_KEY) -> str | None:
    value: str | None = p.evaluate(f"localStorage.getItem('{key}')")
    return value


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # 1. A value under the RETIRED key must not scope anything.
    p, reqs = fresh(b, {RETIRED_KEY: LINCOLN})
    visit(p, "/overview")
    strip = p.inner_text(".scope-line")
    check("retired key: overview request unscoped", *scoped_to(reqs, "/admin/overview", None))
    check("retired key: strip says All schools", "All schools" in strip, strip)
    check("retired key: old key removed", stored(p, RETIRED_KEY) is None)

    # 2. Schools list fails while a school is saved: the strip must not
    #    claim All schools, and must offer the way out.
    p, reqs = fresh(b, {SCOPE_KEY: LINCOLN}, fail_schools=True)
    visit(p, "/overview")
    strip = p.inner_text(".scope-line")
    check("list down: request still scoped", *scoped_to(reqs, "/admin/overview", LINCOLN))
    check("list down: strip does not claim All schools", "All schools —" not in strip, strip)
    clear = p.locator("text=Show all schools")
    check("list down: clear action present", clear.count() == 1)
    if clear.count():
        clear.click()
        p.wait_for_timeout(2000)
        check("list down: clearing unscopes", *scoped_to(reqs, "/admin/overview", None))

    # 3. /schools/:id sets the scope even when the list fails.
    p, reqs = fresh(b, {SCOPE_KEY: RIVER}, fail_schools=True)
    visit(p, f"/schools/{LINCOLN}")
    check("list down: school route sets scope", stored(p) == LINCOLN, str(stored(p)))
    visit(p, "/llm-calls?hours=720")
    check("list down: LLM calls then scoped to that school",
          *scoped_to(reqs, "/admin/llm-calls", LINCOLN))

    # 4. The school page's own LLM-calls links carry the school.
    p, reqs = fresh(b, {SCOPE_KEY: RIVER})
    visit(p, f"/schools/{LINCOLN}")
    hrefs = p.eval_on_selector_all(
        "main a[href*='/llm-calls']", "as => as.map(a => a.getAttribute('href'))")
    school_links = [h for h in hrefs if "user=" not in h]
    check("school page links carry ?school=",
          bool(school_links) and all(f"school={LINCOLN}" in h for h in school_links), str(hrefs))

    # 5. Shared deep links name a school.
    p, reqs = fresh(b, {})
    visit(p, f"/llm-calls?school={RIVER}&hours=720")
    check("?school= deep link scopes LLM calls", *scoped_to(reqs, "/admin/llm-calls", RIVER))
    check("?school= param stripped from URL", "school=" not in p.url, p.url)
    p, reqs = fresh(b, {})
    visit(p, f"/audit-logs?school_id={LINCOLN}")
    check("?school_id= deep link scopes Audit log",
          *scoped_to(reqs, "/audit-logs/timeline", LINCOLN))

    # 6. A school created AFTER the console loaded its school list can be
    #    scoped: opening it refetches the list instead of resetting to All.
    p, reqs = fresh(b, {})
    visit(p, "/overview")  # the list is loaded now, without the new school
    created = _get_json(f"{API}/admin/schools", {
        "name": "Brand New Academy", "contact_name": "N",
        "contact_email": f"new{os.getpid()}{len(results)}@newacademy.org",
    }, token=tok["access_token"])["id"]
    spa_go(p, f"/schools/{created}")
    check("new school: route scope kept after list recheck", stored(p) == created, str(stored(p)))
    spa_go(p, "/overview")
    check("new school: pages scoped to it", *scoped_to(reqs, "/admin/overview", created))
    check("new school: strip names it", "Brand New Academy" in p.inner_text(".scope-line"),
          p.inner_text(".scope-line"))

    # 7. A non-UUID school route never becomes the scope.
    p, reqs = fresh(b, {SCOPE_KEY: LINCOLN})
    visit(p, "/overview")
    spa_go(p, "/schools/not-a-school")
    check("bad /schools/:id leaves scope alone", stored(p) == LINCOLN, str(stored(p)))

    b.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
