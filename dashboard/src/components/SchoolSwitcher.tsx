import { useNavigate } from "react-router-dom";
import { rememberSchool, type SelectedSchool } from "../lib/useSelectedSchool";

/**
 * Name plus place. School names repeat heavily in the real data — the
 * current list holds fourteen "Lincoln High School" — so a name-only
 * picker is fourteen identical rows with nothing to choose between them.
 */
function schoolLabel(s: {
  name: string;
  city: string | null;
  state: string | null;
}): string {
  const where = [s.city, s.state].filter(Boolean).join(", ");
  return where ? `${s.name} — ${where}` : s.name;
}

/**
 * Which school the school-scoped rail links point at.
 *
 * This used to describe itself as "the console's scope control… everything
 * below it is scoped by what's named here." That was false on nine of ten
 * destinations: no page filters its data by this value — Overview, Schools,
 * Leads, Users, Audit log and LLM calls are all platform-wide — and only
 * `Layout` reads it, to build one href. A prominent, persistent scope claim
 * that is wrong almost everywhere is worse than no claim at all, so the
 * copy now says what it does: it selects the school that "Teachers &
 * classes" opens. It is grouped with that link for the same reason.
 *
 * Three shapes, and the third is the important one:
 *
 *   • Two or more schools → a native <select>. Keyboard- and
 *     screen-reader-correct for free, inheriting the console's existing
 *     select styling; a hand-rolled menu would earn nothing beyond a
 *     custom caret.
 *   • Exactly one → the NAME, not a dropdown. The name is context worth
 *     keeping on screen; a select of one is a control with nothing to
 *     control.
 *   • The page is showing a school this list doesn't contain → NOTHING.
 *     `api.schools()` returns institutional schools only, while
 *     GET /schools/{id} has no such filter, so an indie teacher's
 *     synthetic school (reachable from a submission trace) is a real page
 *     the list has never heard of. A <select> whose value matches no
 *     option silently displays the FIRST one, which would have the rail
 *     confidently naming the wrong school. Saying nothing is right.
 *
 * Selection logic lives in `lib/useSelectedSchool` so the rail can read it
 * without this component owning shared state.
 */
export default function SchoolSwitcher({ selected }: { selected: SelectedSchool }) {
  const navigate = useNavigate();

  if (selected.loading || selected.schools.length === 0) return null;

  // `selected.name` is resolved from the list, so a null name here means
  // the current school isn't one we can name — see the third case above.
  const known = selected.name !== null;
  if (!known) return null;

  const onPick = (nextId: string) => {
    rememberSchool(nextId);
    // Straight to the school page, carrying nothing over. An earlier cut
    // forwarded `?tab=` so a switch would keep your place — but
    // SchoolDetail has no tabs and never reads it, and the only page that
    // WRITES `?tab=` is AI quality, so switching school from
    // /ai-quality?tab=harness produced /schools/<id>?tab=harness: a
    // foreign key on a page with no tabs. Carrying a param the
    // destination can't use is worse than dropping it.
    navigate(`/schools/${nextId}`);
  };

  const many = selected.schools.length > 1;

  return (
    <div className="school-switcher">
      {/* One school and many render as the SAME object — a name in ink,
          with a caret when there is something to choose. They are the same
          thing; the box, fill and border the select used to wear made it
          the loudest element in a rail of flat text, so the chrome sat on
          the context while the actual work below it had none. */}
      {many ? (
        <>
          <label className="school-switcher-label" htmlFor="school-switcher">
            School
          </label>
          <select
            id="school-switcher"
            className="school-switcher-select"
            value={selected.id ?? ""}
            onChange={(e) => onPick(e.target.value)}
          >
            {selected.schools.map((s) => (
              <option key={s.id} value={s.id}>
                {schoolLabel(s)}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <span className="school-switcher-label">School</span>
          <div className="school-switcher-single">{selected.name}</div>
        </>
      )}
    </div>
  );
}
