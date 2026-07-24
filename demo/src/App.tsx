import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import DemoHub from "./pages/DemoHub";

// The four KaTeX-heavy deep-dive stories are code-split so the landing "/"
// ships a lean first paint and never downloads the story/KaTeX chunk until a
// reader actually opens a deep-dive.
const StoryLayout = lazy(() => import("./components/PresentLayout"));
const IntegritySet = lazy(() => import("./pages/IntegritySet"));
const GradingSet = lazy(() => import("./pages/GradingSet"));
const GenerationSet = lazy(() => import("./pages/GenerationSet"));
const TeacherDaySet = lazy(() => import("./pages/TeacherDaySet"));

// Standalone customer demo — a public, self-contained static site (zero API,
// zero auth, all data bundled). One unified self-serve experience:
//   • "/"          → the front door everyone lands on (hero, film, flow, the
//                    four use-case cards, ROI, close)
//   • "/<story>"   → a deep-dive, opened from a card, in a clean story shell
//                    (quiet top bar, jump links, ←/→, fullscreen)
// No admin chrome, no separate presenter home — the same page for a buyer
// reading alone and a founder screening it live.

// Quiet, on-brand placeholder while a lazy story chunk streams in.
function StoryFallback() {
  return (
    <div className="present-fallback" role="status" aria-live="polite">
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* The front door. */}
        <Route
          path="/"
          element={
            <div className="demo-hub-shell">
              <DemoHub />
            </div>
          }
        />

        {/* The deep-dive stories — clean story shell, lazy-loaded. */}
        <Route
          element={
            <Suspense fallback={<StoryFallback />}>
              <StoryLayout />
            </Suspense>
          }
        >
          <Route path="/integrity" element={<IntegritySet />} />
          <Route path="/grading" element={<GradingSet />} />
          <Route path="/generation" element={<GenerationSet />} />
          <Route path="/teacher-day" element={<TeacherDaySet />} />
        </Route>

        {/* Anything else → back to the front door. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
