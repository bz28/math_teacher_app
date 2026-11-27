import { useLocation, useNavigate } from "react-router-dom";
import { setSchoolScope, type SelectedSchool } from "../lib/useSelectedSchool";
import { isInternalOnly, pageScope, schoolLabel } from "../lib/pageScope";

/** The <select> value for All schools. Never a real id (ids are UUIDs). */
const ALL = "";

/**
 * The console's scope control: which school every school-scoped page
 * shows, or All schools.
 *
 * A native <select> — keyboard- and screen-reader-correct for free — with
 * "All schools" first. It is offered even with a single school, because
 * "All schools" is not the same set as that one school: it also holds the
 * rows that belong to no school (admin and system LLM calls).
 *
 * Picking keeps you where you are when the page you're on follows the
 * scope — switching schools on the Quality page should show the Quality
 * page for the other school, not throw you somewhere else. Pages that are
 * about ONE thing (a school, a teacher, a submission) can't follow it, so
 * those go to the chosen school's page, or the Schools directory for All
 * schools — otherwise the rail would name a school the page isn't about.
 */
export default function SchoolSwitcher({ selected }: { selected: SelectedSchool }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  if (selected.loading || selected.schools.length === 0) return null;

  const onPick = (value: string) => {
    const next = value === ALL ? null : value;
    setSchoolScope(next);
    if (pageScope(pathname, search) === null) {
      // Carry nothing over: query params belong to the page they were
      // written on, not the one we land on.
      navigate(next ? `/schools/${next}` : "/schools");
    } else {
      // Staying put — but a page number from the old school's list can
      // point past the end of the new one's. Pages that keep their offset
      // in the URL (Audit log) start over; the rest remount (Layout).
      // Picking a scope also ends the Calls page's "Internal only" filter
      // (?school=internal), or the pick would change nothing on screen.
      const params = new URLSearchParams(search);
      const internal = isInternalOnly(pathname, search);
      if (params.has("offset") || internal) {
        params.delete("offset");
        if (internal) params.delete("school");
        navigate({ pathname, search: params.toString() }, { replace: true });
      }
    }
  };

  return (
    <div className="school-switcher">
      <label className="school-switcher-label" htmlFor="school-switcher">
        Scope
      </label>
      <select
        id="school-switcher"
        className="school-switcher-select"
        // A scope the list can't name falls back to All schools in
        // useSelectedSchool, so the value always matches an option — a
        // <select> whose value matches none silently shows the first.
        value={selected.name !== null ? selected.id! : ALL}
        onChange={(e) => onPick(e.target.value)}
      >
        <option value={ALL}>All schools</option>
        {selected.schools.map((s) => (
          <option key={s.id} value={s.id}>
            {schoolLabel(s)}
          </option>
        ))}
      </select>
    </div>
  );
}
