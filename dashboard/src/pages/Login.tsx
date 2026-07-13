import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getUserRole, setToken, NetworkError } from "../lib/api";

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
        // login() already persisted the (valid, non-admin) tokens. Clear
        // them so the next visit doesn't drop a non-admin into the
        // operator shell where every call 403s.
        setToken(null);
        setError("Admin access only. Teachers and students should use veradicai.com.");
        return;
      }
      navigate("/");
    } catch (err) {
      // Only a rejected credential should read as "invalid credentials".
      // Timeouts / 5xx / unreachable-server carry their own message so the
      // operator isn't misled into re-typing a correct password.
      if (err instanceof NetworkError) {
        setError(
          err.message === "timeout"
            ? "The server took too long to respond. Please try again."
            : "Can't reach the server. Check your connection and try again.",
        );
      } else {
        setError(err instanceof Error && err.message ? err.message : "Sign-in failed. Please try again.");
      }
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
          <h1>Reset password</h1>
          <p className="login-eyebrow">Operations</p>
          {forgotSent ? (
            <div style={{ textAlign: "center" }}>
              <p style={{ color: "var(--ok)", fontWeight: 600, marginBottom: 8, fontFamily: "var(--font-sans)" }}>
                Check your email
              </p>
              <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16, fontFamily: "var(--font-sans)" }}>
                If an account exists for <strong>{forgotEmail}</strong>, we sent a reset link.
              </p>
              <button
                onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(""); }}
                style={{ color: "var(--accent)", fontWeight: 500, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-sans)" }}
              >
                Back to sign-in
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={handleForgotPassword}>
                <input
                  type="email"
                  placeholder="Email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                />
                <button type="submit" disabled={forgotLoading}>
                  {forgotLoading ? "Sending…" : "Send reset link"}
                </button>
              </form>
              <div style={{ textAlign: "center", marginTop: 14 }}>
                <button
                  onClick={() => setShowForgot(false)}
                  style={{ color: "var(--muted)", fontSize: 12, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-sans)" }}
                >
                  Back to sign-in
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="login-form">
          <h1>Veradic</h1>
          <p className="login-eyebrow">Operations / Sign in</p>
          {error && <p className="error">{error}</p>}
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="submit">Sign in</button>
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              style={{ color: "var(--muted)", fontSize: 12, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-sans)" }}
            >
              Forgot password?
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
