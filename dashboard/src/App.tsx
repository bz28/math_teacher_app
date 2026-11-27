import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getToken } from "./lib/api";
import Layout from "./components/Layout";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { ToastProvider } from "./components/ToastProvider";
import ServiceStatusBanner from "./components/ServiceStatusBanner";
import Login from "./pages/Login";
import LLMCalls from "./pages/LLMCalls";
import Accuracy from "./pages/Accuracy";
import Users from "./pages/Users";
import ReportDetail from "./pages/ReportDetail";
import Reports from "./pages/Reports";
import Schools from "./pages/Schools";
import SchoolDetail from "./pages/SchoolDetail";
import StudentDetail from "./pages/StudentDetail";
import TeacherDetail from "./pages/TeacherDetail";
import AuditLogs from "./pages/AuditLogs";
import AssignmentDetail from "./pages/AssignmentDetail";
import SubmissionTrace from "./pages/SubmissionTrace";
import Costs from "./pages/Costs";

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
          {/* Landing = LLM calls, the debugging home. */}
          <Route path="/" element={<Navigate to="/llm-calls" replace />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:reportId" element={<ReportDetail />} />
          <Route path="/schools" element={<Schools />} />
          <Route path="/schools/:schoolId" element={<SchoolDetail />} />
          <Route path="/students/:studentId" element={<StudentDetail />} />
          <Route path="/teachers/:teacherId" element={<TeacherDetail />} />
          {/* Admins consolidated into the role-filtered Users tab.
              /admins stays as a redirect so old bookmarks/links land
              on the Admins preset. */}
          <Route path="/admins" element={<Navigate to="/users?role=admin" replace />} />

          {/* Diagnostics. */}
          <Route path="/audit-logs" element={<AuditLogs />} />
          <Route path="/llm-calls" element={<LLMCalls />} />
          <Route path="/accuracy" element={<Accuracy />} />
          {/* The two quality pages merged into Accuracy's tabs; their old
              routes land on the matching tab so bookmarks keep working. */}
          <Route path="/extraction-quality" element={<Navigate to="/accuracy" replace />} />
          <Route path="/grading-quality" element={<Navigate to="/accuracy?tab=grading" replace />} />
          <Route path="/assignments/:id" element={<AssignmentDetail />} />
          <Route
            path="/submissions/:submissionId/trace"
            element={<SubmissionTrace />}
          />

          <Route path="/users" element={<Users />} />

          {/* Money. */}
          <Route path="/costs" element={<Costs />} />

          <Route path="*" element={<Navigate to="/llm-calls" replace />} />
        </Route>
      </Routes>
      </ToastProvider>
      </ConfirmProvider>
    </BrowserRouter>
  );
}
