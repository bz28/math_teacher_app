import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PresentLayout from "./components/PresentLayout";
import DemoHub from "./pages/DemoHub";
import PresentOverview from "./pages/PresentOverview";
import IntegritySet from "./pages/IntegritySet";
import GradingSet from "./pages/GradingSet";
import GenerationSet from "./pages/GenerationSet";
import TeacherDaySet from "./pages/TeacherDaySet";

// Standalone customer demo — a public, self-contained static site (zero API,
// zero auth, all data bundled). Two surfaces:
//   • "/"        → the front-door hub (the founder's overview a teacher lands on)
//   • "/present" → the full-screen presenter shell + the four deep-dive stories
// No admin chrome, no ProtectedRoute. Lifted verbatim out of the ops dashboard.

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

        {/* Present mode — the founder's full-screen pitch shell. */}
        <Route element={<PresentLayout />}>
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
