import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getUserRole } from "../lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  // Forgot password
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.login(email, password);
      const role = getUserRole();
      if (role !== "admin") {
        setError("Admin access only. Teachers and students should use veradicai.com.");
        return;
      }
      navigate("/");
    } catch {
      setError("Invalid credentials.");
    }
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    setForgotLoading(true);
    try {
      await api.forgotPassword(forgotEmail);
      setForgotSent(true);
    } catch {
      setForgotSent(true);
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <div className="login-page">
      {showForgot ? (
        <div className="login-form">
          <h1 style={{ fontSize: 20 }}>Reset Password</h1>
          {forgotSent ? (
            <div style={{ textAlign: "center" }}>
              <p style={{ color: "#16a34a", fontWeight: 600, marginBottom: 8 }}>Check your email</p>
              <p style={{ color: "#64748b", fontSize: 14, marginBottom: 16 }}>
                If an account exists for <strong>{forgotEmail}</strong>, we sent a reset link.
              </p>
              <button
                onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(""); }}
                style={{ color: "#6366f1", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}
              >
                Back to Login
              </button>
            </div>
          ) : (
            <>
              <p style={{ color: "#64748b", fontSize: 14, marginBottom: 16, marginTop: -16, textAlign: "center" }}>
                Enter your email to receive a reset link.
              </p>
              <form onSubmit={handleForgotPassword}>
                <input
                  type="email"
                  placeholder="Email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                />
                <button type="submit" disabled={forgotLoading}>
                  {forgotLoading ? "Sending..." : "Send Reset Link"}
                </button>
              </form>
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button
                  onClick={() => setShowForgot(false)}
                  style={{ color: "#64748b", fontSize: 13, background: "none", border: "none", cursor: "pointer" }}
                >
                  Back to Login
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="login-form">
          <h1>Veradic AI</h1>
          <p style={{ textAlign: "center", color: "#64748b", marginBottom: 20, marginTop: -16 }}>
            Admin Dashboard
          </p>
          {error && <p className="error">{error}</p>}
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="submit">Login</button>
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              style={{ color: "#64748b", fontSize: 13, background: "none", border: "none", cursor: "pointer" }}
            >
              Forgot password?
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
