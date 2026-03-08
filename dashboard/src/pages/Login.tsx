import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

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
      navigate("/");
    } catch {
      setError("Invalid credentials or not an admin.");
    }
  }

  return (
    <div className="login-page">
      <form onSubmit={handleSubmit} className="login-form">
        <h1>Admin Login</h1>
        {error && <p className="error">{error}</p>}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit">Login</button>
      </form>
    </div>
  );
}
