import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getToken } from "./lib/api";
import Layout from "./components/Layout";
import { ConfirmProvider } from "./components/ConfirmProvider";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import LLMCalls from "./pages/LLMCalls";
import Quality from "./pages/Quality";
import Users from "./pages/Users";
import LeadDetail from "./pages/LeadDetail";
import Leads from "./pages/Leads";
import Schools from "./pages/Schools";
import SchoolDetail from "./pages/SchoolDetail";
import IndependentStudents from "./pages/IndependentStudents";
import IndependentTeachers from "./pages/IndependentTeachers";
import TeacherDetail from "./pages/TeacherDetail";
import Admins from "./pages/Admins";
import SubmissionTrace from "./pages/SubmissionTrace";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ConfirmProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* Primary destinations — each is its own audience. */}
          <Route path="/" element={<Navigate to="/leads" replace />} />
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
          <Route path="/admins" element={<Admins />} />

          {/* Diagnostics. */}
          <Route path="/llm-calls" element={<LLMCalls />} />
          <Route path="/quality" element={<Quality />} />
          <Route
            path="/submissions/:submissionId/trace"
            element={<SubmissionTrace />}
          />

          {/* Hidden but reachable by URL — kept so phase 2 can
              decide whether to surface them. */}
          <Route path="/overview" element={<Overview />} />
          <Route path="/users" element={<Users />} />

          <Route path="*" element={<Navigate to="/leads" replace />} />
        </Route>
      </Routes>
      </ConfirmProvider>
    </BrowserRouter>
  );
}
