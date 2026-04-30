import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getToken } from "./lib/api";
import { ScopeProvider } from "./lib/scope";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import LLMCalls from "./pages/LLMCalls";
import Quality from "./pages/Quality";
import Users from "./pages/Users";
import Leads from "./pages/Leads";
import Schools from "./pages/Schools";
import SchoolOverview from "./pages/SchoolOverview";
import SubmissionTrace from "./pages/SubmissionTrace";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <ScopeProvider>
                <Layout />
              </ScopeProvider>
            </ProtectedRoute>
          }
        >
          {/* Admin scope — everything view */}
          <Route path="/" element={<Navigate to="/admin/overview" replace />} />
          <Route path="/admin/overview" element={<Overview />} />
          <Route path="/admin/llm-calls" element={<LLMCalls />} />
          <Route path="/admin/quality" element={<Quality />} />
          <Route path="/admin/users" element={<Users />} />
          <Route path="/admin/schools" element={<Schools />} />
          <Route path="/admin/leads" element={<Leads />} />
          <Route
            path="/admin/submissions/:submissionId/trace"
            element={<SubmissionTrace />}
          />

          {/* School scope — every page filtered to one school
              (or to the internal/no-school bucket). Real metric
              pages land in PR D; v1 ships scoped LLM Calls and a
              placeholder Overview. */}
          <Route
            path="/school/:schoolId/overview"
            element={<SchoolOverview />}
          />
          <Route
            path="/school/:schoolId/llm-calls"
            element={<LLMCalls />}
          />
          <Route
            path="/school/:schoolId/submissions/:submissionId/trace"
            element={<SubmissionTrace />}
          />
          {/* /school/:id with no subpath lands on Overview rather
              than rendering an empty Layout. */}
          <Route
            path="/school/:schoolId"
            element={<SchoolOverview />}
          />

          {/* Anything else under the protected layout (including
              bare /school) bounces back to Admin Overview rather
              than rendering a blank page. */}
          <Route path="*" element={<Navigate to="/admin/overview" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
