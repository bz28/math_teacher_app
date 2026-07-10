import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import DemoHub from "./pages/DemoHub";

// The present-mode surfaces (the full-screen presenter shell + the four
// KaTeX-heavy deep-dive stories) are only reached from "/present". Code-split
// them so the buyer's landing "/" ships a lean first paint and never downloads
// the story/KaTeX chunk until the founder actually steps into present mode.
const PresentLayout = lazy(() => import("./components/PresentLayout"));
const PresentOverview = lazy(() => import("./pages/PresentOverview"));
const IntegritySet = lazy(() => import("./pages/IntegritySet"));
const GradingSet = lazy(() => import("./pages/GradingSet"));
const GenerationSet = lazy(() => import("./pages/GenerationSet"));
const TeacherDaySet = lazy(() => import("./pages/TeacherDaySet"));

// Standalone customer demo — a public, self-contained static site (zero API,
// zero auth, all data bundled). Two surfaces:
//   • "/"        → the front-door hub (the founder's overview a teacher lands on)
//   • "/present" → the full-screen presenter shell + the four deep-dive stories
// No admin chrome, no ProtectedRoute. Lifted verbatim out of the ops dashboard.

// Quiet, on-brand placeholder while a lazy present-mode chunk streams in.
function PresentFallback() {
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

        {/* Present mode — the founder's full-screen pitch shell. Lazy-loaded. */}
        <Route
          element={
            <Suspense fallback={<PresentFallback />}>
              <PresentLayout />
            </Suspense>
          }
        >
          <Route path="/present" element={<PresentOverview />} />
          <Route path="/present/integrity" element={<IntegritySet />} />
          <Route path="/present/grading" element={<GradingSet />} />
          <Route path="/present/generation" element={<GenerationSet />} />
          <Route path="/present/teacher-day" element={<TeacherDaySet />} />
        </Route>

        {/* Anything else → back to the hub. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
