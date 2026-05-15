import UserScopePanel from "../components/UserScopePanel";

export default function IndependentStudents() {
  return (
    <UserScopePanel
      eyebrow="Audience"
      title="Independent students"
      subtitle="Consumer learners with no school affiliation — find the conversion-ready, the heavy users, and the silent churners."
      role="student"
      showDailyUsage
      showStudentChips
      emptyMessage="No independent students for this window."
    />
  );
}
