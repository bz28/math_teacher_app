import UserScopePanel from "../components/UserScopePanel";

export default function IndependentStudents() {
  return (
    <UserScopePanel
      eyebrow="Audience"
      title="Independent students"
      subtitle="Students with no school affiliation — consumer learners and founder/test accounts."
      role="student"
      showDailyUsage
      emptyMessage="No independent students for this window."
    />
  );
}
