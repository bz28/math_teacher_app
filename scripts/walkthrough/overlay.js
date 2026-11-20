// Injected into every page of the recording (context init script).
//
// - A visible cursor that follows real (Playwright) mouse events, with a
//   ripple on press. It survives navigations by remembering its last
//   position in sessionStorage.
// - Hides the Next.js dev-tools badge, which is not part of the product.
// - window.__wtSync(color) paints a full-screen colour block for the
//   recorder's audio/video sync mark; window.__wtRipple(x, y) draws a click
//   ripple without a real click (used for native <select>s).
(() => {
  if (window.__wtInstalled) return;
  window.__wtInstalled = true;

  const KEY = "__wt_cursor_pos";
  let pos = { x: 720, y: 450 };
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (saved) pos = saved;
  } catch (e) {}

  const css = `
    nextjs-portal { display: none !important; }
    #__wt_cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px;
      z-index: 2147483647; pointer-events: none; will-change: transform;
      transition: transform 0s; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
    #__wt_cursor svg { transition: transform .12s ease-out; transform-origin: 3px 2px; }
    #__wt_cursor.down svg { transform: scale(.86); }
    .__wt_ripple { position: fixed; width: 44px; height: 44px; margin: -22px 0 0 -22px;
      border-radius: 50%; pointer-events: none; z-index: 2147483646;
      border: 3px solid rgba(14, 82, 56, .85); background: rgba(14, 82, 56, .18);
      animation: __wt_ripple .55s ease-out forwards; }
    @keyframes __wt_ripple { from { transform: scale(.25); opacity: 1; }
                             to { transform: scale(1.35); opacity: 0; } }
    #__wt_sync { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
  `;

  function place(el) {
    el.style.transform = `translate(${pos.x - 3}px, ${pos.y - 2}px)`;
  }

  function ripple(x, y) {
    const r = document.createElement("div");
    r.className = "__wt_ripple";
    r.style.left = x + "px";
    r.style.top = y + "px";
    document.documentElement.appendChild(r);
    setTimeout(() => r.remove(), 700);
  }

  function install() {
    if (document.getElementById("__wt_cursor")) return;
    const style = document.createElement("style");
    style.id = "__wt_style";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

    const c = document.createElement("div");
    c.id = "__wt_cursor";
    c.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M3 2 L3 21 L8.2 16.4 L11.6 24 L15 22.5 L11.7 15.1 L18.6 15.1 Z" ' +
      'fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    // A sibling of <body>: React treats <html>/<body> as singletons and
    // leaves foreign nodes alone, so hydration never removes it.
    document.documentElement.appendChild(c);
    place(c);

    document.addEventListener("mousemove", (e) => {
      pos = { x: e.clientX, y: e.clientY };
      place(c);
      try { sessionStorage.setItem(KEY, JSON.stringify(pos)); } catch (err) {}
    }, true);
    document.addEventListener("mousedown", (e) => {
      c.classList.add("down");
      ripple(e.clientX, e.clientY);
    }, true);
    document.addEventListener("mouseup", () => c.classList.remove("down"), true);
  }

  window.__wtRipple = (x, y) => ripple(x, y);
  window.__wtSync = (color) => {
    let s = document.getElementById("__wt_sync");
    if (!color) { if (s) s.remove(); return; }
    if (!s) {
      s = document.createElement("div");
      s.id = "__wt_sync";
      document.documentElement.appendChild(s);
    }
    s.style.background = color;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();
