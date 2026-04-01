import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getToken } from "./lib/api";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import LLMCalls from "./pages/LLMCalls";
import Quality from "./pages/Quality";
import Users from "./pages/Users";
import PromoCodes from "./pages/PromoCodes";
import Schools from "./pages/Schools";

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
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Overview />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/llm-calls" element={<LLMCalls />} />
          <Route path="/quality" element={<Quality />} />
          <Route path="/users" element={<Users />} />
          <Route path="/promo-codes" element={<PromoCodes />} />
          <Route path="/schools" element={<Schools />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
