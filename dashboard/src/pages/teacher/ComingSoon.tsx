export default function ComingSoon({ title }: { title: string }) {
  return (
    <div>
      <div className="page-header">
        <h1>{title}</h1>
      </div>
      <div className="table-card" style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: "#475569", marginBottom: 8 }}>Coming Soon</div>
        <p>This feature is under development.</p>
      </div>
    </div>
  );
}
