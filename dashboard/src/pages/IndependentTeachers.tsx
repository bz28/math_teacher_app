import UserScopePanel from "../components/UserScopePanel";

export default function IndependentTeachers() {
  return (
    <UserScopePanel
      eyebrow="Audience"
      title="Independent teachers"
      subtitle="Teachers piloting outside a school deal — useful for outreach and finding power-users to convert."
      role="teacher"
      emptyMessage="No independent teachers for this window."
    />
  );
}
