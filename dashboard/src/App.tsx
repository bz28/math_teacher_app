import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getToken, getUserRole } from "./lib/api";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import LLMCalls from "./pages/LLMCalls";
import Quality from "./pages/Quality";
import Users from "./pages/Users";
import PromoCodes from "./pages/PromoCodes";
import CourseList from "./pages/teacher/CourseList";
import CourseDetail from "./pages/teacher/CourseDetail";
import ComingSoon from "./pages/teacher/ComingSoon";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleRedirect() {
  const role = getUserRole();
  if (role === "teacher") return <Navigate to="/courses" replace />;
  return <Overview />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<RoleRedirect />} />

          {/* Admin */}
          <Route path="/overview" element={<Overview />} />
          <Route path="/llm-calls" element={<LLMCalls />} />
          <Route path="/quality" element={<Quality />} />
          <Route path="/users" element={<Users />} />
          <Route path="/promo-codes" element={<PromoCodes />} />

          {/* Teacher */}
          <Route path="/courses" element={<CourseList />} />
          <Route path="/courses/:courseId/*" element={<CourseDetail />} />
          <Route path="/homework" element={<ComingSoon title="Homework" />} />
          <Route path="/tests" element={<ComingSoon title="Tests" />} />
          <Route path="/analytics" element={<ComingSoon title="Analytics" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
