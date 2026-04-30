import { useScope, INTERNAL_SCHOOL_ID } from "../lib/scope-context";

// Single dropdown that drives the entire dashboard's scope. Three
// shapes:
//   - "Admin (everything)" — the cross-school god-view (Schools list,
//     Leads, total platform cost, etc.)
//   - "School: <name>" — every page filtered to that school's data
//   - "Internal (no-school)" — the special bucket for school_id IS
//     NULL: founder/test accounts, sandbox HWs, non-school learners.
//
// Selecting an option navigates to the matching URL prefix
// (/admin/... or /school/:id/...). Pages re-fetch with the new
// scope's school filter automatically because they read it from
// useScope().apiSchoolFilter().
export default function ScopePicker() {
  const { scope, schools, enterAdmin, enterSchool } = useScope();

  const value =
    scope.kind === "admin"
      ? "__admin__"
      : scope.schoolId;

  const handleChange = (next: string) => {
    if (next === "__admin__") {
      enterAdmin();
      return;
    }
    enterSchool(next);
  };

  return (
    <div className="scope-picker">
      <label className="scope-picker-label">Scope</label>
      <select
        className="scope-picker-select"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
      >
        <option value="__admin__">Admin (everything)</option>
        <option value={INTERNAL_SCHOOL_ID}>Internal (no-school)</option>
        {schools.length > 0 && (
          <optgroup label="Schools">
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
