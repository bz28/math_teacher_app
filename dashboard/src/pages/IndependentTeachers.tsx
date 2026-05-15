import UserScopePanel from "../components/UserScopePanel";

export default function IndependentTeachers() {
  return (
    <UserScopePanel
      eyebrow="Audience"
      title="Independent teachers"
      subtitle="Teachers piloting outside a school deal — find the ones with real classrooms and convert."
      role="teacher"
      showClassroom
      emptyMessage="No independent teachers for this window."
    />
  );
}
