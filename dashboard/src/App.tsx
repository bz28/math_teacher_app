import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getToken } from "./lib/api";
import Layout from "./components/Layout";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { ToastProvider } from "./components/ToastProvider";
import ServiceStatusBanner from "./components/ServiceStatusBanner";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import LLMCalls from "./pages/LLMCalls";
import HarnessRuns from "./pages/HarnessRuns";
import Quality from "./pages/Quality";
import SessionQuality from "./pages/SessionQuality";
import GradingQuality from "./pages/GradingQuality";
import GoldenSet from "./pages/GoldenSet";
import Users from "./pages/Users";
import LeadDetail from "./pages/LeadDetail";
import Leads from "./pages/Leads";
import Schools from "./pages/Schools";
import SchoolDetail from "./pages/SchoolDetail";
import IndependentStudents from "./pages/IndependentStudents";
import IndependentTeachers from "./pages/IndependentTeachers";
import TeacherDetail from "./pages/TeacherDetail";
import AuditLogs from "./pages/AuditLogs";
import SubmissionTrace from "./pages/SubmissionTrace";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ServiceStatusBanner />
      <ConfirmProvider>
      <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* Landing = the "what's broken" home. Monitor first. */}
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/leads/:leadId" element={<LeadDetail />} />
          <Route path="/schools" element={<Schools />} />
          <Route path="/schools/:schoolId" element={<SchoolDetail />} />
          <Route
            path="/students/independent"
            element={<IndependentStudents />}
          />
          <Route
            path="/teachers/independent"
            element={<IndependentTeachers />}
          />
          <Route path="/teachers/:teacherId" element={<TeacherDetail />} />
          {/* Admins consolidated into the role-filtered Users tab.
              /admins stays as a redirect so old bookmarks/links land
              on the Admins preset. */}
          <Route path="/admins" element={<Navigate to="/users?role=admin" replace />} />

          {/* Diagnostics. */}
          <Route path="/audit-logs" element={<AuditLogs />} />
          <Route path="/llm-calls" element={<LLMCalls />} />
          <Route path="/harness-runs" element={<HarnessRuns />} />
          <Route path="/quality" element={<Quality />} />
          <Route path="/quality/:sessionId" element={<SessionQuality />} />
          <Route path="/grading-quality" element={<GradingQuality />} />
          <Route path="/golden-set" element={<GoldenSet />} />
          <Route
            path="/submissions/:submissionId/trace"
            element={<SubmissionTrace />}
          />

          {/* Overview — the operator home, first item in MONITOR. */}
          <Route path="/overview" element={<Overview />} />
          {/* Users — now surfaced under SYSTEM in the rail. */}
          <Route path="/users" element={<Users />} />

          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Route>
      </Routes>
      </ToastProvider>
      </ConfirmProvider>
    </BrowserRouter>
  );
}
