import IndependentPanel from "../components/IndependentPanel";

export default function IndependentTeachers() {
  return (
    <IndependentPanel
      eyebrow="Audience"
      title="Independent teachers"
      subtitle="Teachers using Veradic outside a school deal — who they are and how active they've been."
      role="teacher"
      emptyMessage="No independent teachers for this window."
    />
  );
}
