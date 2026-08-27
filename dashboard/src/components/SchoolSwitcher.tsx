import { useLocation, useNavigate } from "react-router-dom";
import { rememberSchool, type SelectedSchool } from "../lib/useSelectedSchool";

/**
 * The console's scope control, directly under the wordmark because
 * everything in "This school" below it is scoped by what's named here.
 *
 * Two shapes, deliberately:
 *
 *   • With one school it renders the NAME, not a dropdown. The name is
 *     context worth keeping on screen; a select of one is a control with
 *     nothing to control.
 *   • With two or more it becomes a native <select> — keyboard- and
 *     screen-reader-correct for free, inheriting the console's existing
 *     select styling. A hand-rolled menu would earn nothing here beyond a
 *     custom caret.
 *
 * Selection logic lives in `lib/useSelectedSchool` so the rail can read it
 * without this component owning shared state.
 */
export default function SchoolSwitcher({ selected }: { selected: SelectedSchool }) {
  const navigate = useNavigate();
  const location = useLocation();

  if (selected.loading || selected.schools.length === 0) return null;

  const onPick = (nextId: string) => {
    rememberSchool(nextId);
    // Stay on the same sub-page. Switching schools while looking at
    // Teachers should show the OTHER school's teachers, not bounce to its
    // overview and make you find your place again.
    const tab = new URLSearchParams(location.search).get("tab");
    navigate(`/schools/${nextId}${tab ? `?tab=${tab}` : ""}`);
  };

  return (
    <div className="school-switcher">
      <label
        className="school-switcher-label"
        htmlFor={selected.schools.length > 1 ? "school-switcher" : undefined}
      >
        School
      </label>
      {selected.schools.length > 1 ? (
        <select
          id="school-switcher"
          value={selected.id ?? ""}
          onChange={(e) => onPick(e.target.value)}
        >
          {selected.schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : (
        <div className="school-switcher-single">{selected.name}</div>
      )}
    </div>
  );
}
