import { Suspense, useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { STORY_HOME, STORIES } from "../lib/present-stories";

// The story shell. A full-bleed, sidebar-free frame that wraps the deep-dive
// stories (IntegritySet/GradingSet/…) in a quiet hairline top bar — the same
// clean surface whether a buyer opens a card alone or a founder screens it live.
//
// Navigation:
//   • wordmark   — back to the front door
//   • jump links — the four stories, current one highlighted
//   • ← / →      — previous / next story in pitch order
//   • Esc / Home — back to the front door
// Arrow-key nav is suppressed whenever a form control is focused so the ROI
// calculator's sliders and inputs keep their native behavior.

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute("role") === "slider") return true;
  return false;
}

export default function PresentLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Index of the current story in pitch order (-1 if not on a story).
  const currentIndex = STORIES.findIndex((s) => s.path === location.pathname);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never hijack typing or slider adjustment, and stay out of the way of
      // browser/OS shortcuts (Cmd/Ctrl/Alt-combos).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      if (e.key === "Escape" || e.key === "Home") {
        // In fullscreen, let Esc exit fullscreen first — don't also navigate
        // home, which would lose the reader's place mid-story.
        if (e.key === "Escape" && document.fullscreenElement) return;
        e.preventDefault();
        navigate(STORY_HOME);
        return;
      }

      if (e.key === "ArrowRight") {
        const next = currentIndex < 0 ? STORIES[0] : STORIES[currentIndex + 1];
        if (next) {
          e.preventDefault();
          navigate(next.path);
        }
      } else if (e.key === "ArrowLeft") {
        if (currentIndex > 0) {
          e.preventDefault();
          navigate(STORIES[currentIndex - 1].path);
        } else if (currentIndex === 0) {
          e.preventDefault();
          navigate(STORY_HOME);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentIndex, location.pathname, navigate]);

  // New story → start at the top, like opening a fresh slide.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="present-shell">
      <header className="present-bar">
        <div className="present-bar-left">
          <NavLink to={STORY_HOME} className="present-wordmark">
            Veradic
          </NavLink>
        </div>

        <nav className="present-jump" aria-label="Demo stories">
          {STORIES.map((s) => (
            <NavLink
              key={s.key}
              to={s.path}
              className={({ isActive }) =>
                `present-jump-link ${isActive ? "active" : ""}`
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          className="present-fs-btn"
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        </button>
      </header>

      <main className="present-content">
        {/* Each story page is a lazy chunk; keep the bar mounted and swap only
            the content area while the next story streams in. */}
        <Suspense
          fallback={
            <div className="present-fallback" role="status" aria-live="polite">
              Loading…
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
