// The front-door hero panel: a distilled, illustrative slice of the teacher's
// understanding-check roster. It renders the headline at a glance — most of the
// class Understood, one surfaced for the teacher's eyes — and the opened
// student shows the AI's own reasoning, so "nothing it surfaces is a black box"
// is shown, not just claimed. Content mirrors the real product (the flagged
// case: correct work, but couldn't explain it); the panel is a cleaner
// composition of that surface, labeled illustrative.

type RosterRow = {
  name: string;
  status: string;
  tone: "good" | "accent";
  selected?: boolean;
};

const ROSTER: RosterRow[] = [
  { name: "Ava Thompson", status: "Understood", tone: "good" },
  { name: "Noah Park", status: "Understood", tone: "good" },
  { name: "Liam Walsh", status: "Needs your eyes", tone: "accent", selected: true },
];

export default function RosterPeek() {
  return (
    <aside
      className="hero-roster"
      aria-label="Illustrative understanding-check roster"
    >
      <div className="hero-roster-head">
        <span className="hero-roster-course">Quadratics · Period 3</span>
        <span className="hero-roster-meta">
          3 of 3 checked · 1 needs your eyes · you stay the judge
        </span>
      </div>

      <ul className="hero-roster-list">
        {ROSTER.map((r) => (
          <li
            key={r.name}
            className={`hero-roster-row${r.selected ? " is-selected" : ""}`}
            aria-current={r.selected ? "true" : undefined}
          >
            <span className={`hero-roster-mark ${r.tone}`} aria-hidden="true">
              {r.tone === "good" ? "✓" : "▸"}
            </span>
            <span className="hero-roster-name">{r.name}</span>
            <span className={`hero-roster-status ${r.tone}`}>{r.status}</span>
          </li>
        ))}
      </ul>

      <div className="hero-roster-detail">
        <div className="hero-roster-detail-head">
          <span className="hero-roster-detail-dot" aria-hidden="true" />
          <span className="hero-roster-detail-title">
            Review — correct work, but couldn't explain it
          </span>
        </div>
        <p className="hero-roster-detail-body">
          “Solved it correctly, but across the chat couldn't say why factoring
          works or how the roots would change.”
        </p>
        <span className="hero-roster-detail-link">
          View conversation
          <span aria-hidden="true"> →</span>
        </span>
      </div>

      <p className="hero-roster-foot">
        Illustrative — the teacher's understanding-check roster
      </p>
    </aside>
  );
}
