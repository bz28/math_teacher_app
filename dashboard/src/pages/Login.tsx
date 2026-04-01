import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getUserRole } from "../lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

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

  return (
    <div className="login-page">
      <form onSubmit={handleSubmit} className="login-form">
        <h1>Veradic AI</h1>
        <p style={{ textAlign: "center", color: "#64748b", marginBottom: 20, marginTop: -16 }}>
          Admin Dashboard
        </p>
        {error && <p className="error">{error}</p>}
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit">Login</button>
      </form>
    </div>
  );
}
