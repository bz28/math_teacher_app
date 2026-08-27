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
 * The console's scope control, directly under the wordmark because
 * everything in "This school" below it is scoped by what's named here.
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
              {schoolLabel(s)}
            </option>
          ))}
        </select>
      ) : (
        <div className="school-switcher-single">{selected.name}</div>
      )}
    </div>
  );
}
