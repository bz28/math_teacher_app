import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getToken } from "./lib/api";
import { ScopeProvider } from "./lib/scope";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import LLMCalls from "./pages/LLMCalls";
import Quality from "./pages/Quality";
import Users from "./pages/Users";
import PromoCodes from "./pages/PromoCodes";
import Leads from "./pages/Leads";
import Schools from "./pages/Schools";
import SchoolOverviewPlaceholder from "./pages/SchoolOverviewPlaceholder";

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
          <Route path="/admin/promo-codes" element={<PromoCodes />} />
          <Route path="/admin/schools" element={<Schools />} />
          <Route path="/admin/leads" element={<Leads />} />

          {/* School scope — every page filtered to one school
              (or to the internal/no-school bucket). Real metric
              pages land in PR D; v1 ships scoped LLM Calls and a
              placeholder Overview. */}
          <Route
            path="/school/:schoolId/overview"
            element={<SchoolOverviewPlaceholder />}
          />
          <Route
            path="/school/:schoolId/llm-calls"
            element={<LLMCalls />}
          />

          {/* Legacy URL backwards-compat — old bookmarks
              redirect into Admin. */}
          <Route path="/overview" element={<Navigate to="/admin/overview" replace />} />
          <Route path="/llm-calls" element={<Navigate to="/admin/llm-calls" replace />} />
          <Route path="/quality" element={<Navigate to="/admin/quality" replace />} />
          <Route path="/users" element={<Navigate to="/admin/users" replace />} />
          <Route path="/promo-codes" element={<Navigate to="/admin/promo-codes" replace />} />
          <Route path="/schools" element={<Navigate to="/admin/schools" replace />} />
          <Route path="/leads" element={<Navigate to="/admin/leads" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
