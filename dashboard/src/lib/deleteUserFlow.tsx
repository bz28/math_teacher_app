import { api, type UserDeleteImpact } from "./api";
import type { ConfirmFn } from "./confirm";

/**
 * The one place that decides how deleting an account is confirmed.
 *
 * ## Why it's shared
 *
 * Delete-user already shipped on the Users page and the independent
 * teachers/students panel, and is now on the school page too. Three
 * call sites each writing their own dialog is how you end up with the
 * dangerous one being the least careful — so the decision lives here
 * and the surfaces just call it.
 *
 * ## Why the friction is proportional
 *
 * `DELETE /admin/users/{id}` is a hard delete that cascades:
 *
 *     users.id → assignments.teacher_id → submissions → grades
 *
 * Deleting a teacher therefore destroys every homework they wrote and
 * every submission and grade on it, belonging to students who are NOT
 * being deleted and whose accounts survive.
 *
 * But most deletions in this console are empty accounts — a duplicate,
 * a test signup, someone who never logged in. If those got the scary
 * dialog too, an operator would learn to dismiss it, and the gate
 * would fail on the one day it mattered. Warnings decay through
 * repetition.
 *
 * So the impact is fetched first and the friction matches it:
 *
 *   nothing attached → an ordinary confirm, no ceremony
 *   work attached    → exact counts, and the account's name must be
 *                      typed out, which is the one gesture muscle
 *                      memory can't perform
 *
 * Deactivation is offered as prose here and as a real button on each
 * surface: nearly every reason to remove a teacher (left the school,
 * wrong account, shouldn't have access) is served by revoking access,
 * and none of them want a term of student work destroyed.
 */

function countLine(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** True when deleting this account destroys something. */
export function hasImpact(i: UserDeleteImpact): boolean {
  return (
    i.assignments_destroyed > 0 ||
    i.submissions_destroyed > 0 ||
    i.grades_destroyed > 0
  );
}

/**
 * Confirm and perform an account deletion.
 *
 * Returns true when the account was deleted, false when the operator
 * backed out. Throws whatever the API threw so the caller can toast it
 * — the caller owns its own error surface.
 */
export async function confirmAndDeleteUser(
  confirm: ConfirmFn,
  userId: string,
  fallbackLabel: string,
): Promise<boolean> {
  let impact: UserDeleteImpact | null = null;
  try {
    impact = await api.userDeleteImpact(userId);
  } catch {
    impact = null;
  }

  const label = impact?.name || impact?.email || fallbackLabel;

  // ── Unknown damage is treated as the WORST case, not the best ──
  //
  // This branch used to be a one-click "Delete anyway" — strictly LESS
  // friction than the known-damage path. That inverted the whole
  // design: the preflight is most likely to fail on the biggest
  // accounts (it is the heaviest query), so the teacher whose deletion
  // destroys the most work was the one who skipped the gate.
  //
  // An unknown number is not a small number. It gets the same typed
  // confirmation as known damage.
  if (!impact) {
    if (!(await confirm({
      title: `Permanently delete ${label}?`,
      message: (
        <>
          <p style={{ margin: "0 0 8px" }}>
            <strong>We couldn't check what this would destroy.</strong>
          </p>
          <p style={{ margin: "0 0 8px" }}>
            If this is a teacher, deleting them also permanently deletes
            every homework they created and every student submission and
            grade on it — work belonging to students who are not being
            deleted.
          </p>
          <p style={{ margin: 0 }}>
            Deactivating instead revokes access and keeps everything.
            This cannot be undone.
          </p>
        </>
      ),
      confirmLabel: "Delete anyway",
      requireTypedConfirmation: label,
    }))) return false;
    await api.deleteUser(userId);
    return true;
  }

  // ── Nothing attached: routine, so keep it routine ──
  if (!hasImpact(impact)) {
    if (!(await confirm({
      title: `Delete ${label}?`,
      // Deliberately narrower than "nothing else is attached". The
      // preflight counts homework, submissions and grades; it does NOT
      // count every table that cascades off a user (tutoring work,
      // uploaded documents, practice activity). Claiming "nothing" was
      // asserting something this endpoint cannot see — the exact
      // defect this whole dialog exists to stop.
      message: (
        <>
          <strong>{impact.email}</strong> will be removed permanently. No
          homework, submissions or grades are attached to this account.
          This cannot be undone.
        </>
      ),
      confirmLabel: "Delete",
    }))) return false;
    await api.deleteUser(userId);
    return true;
  }

  // ── Work attached: state it, and make them type the name ──
  const isTeacher = impact.role === "teacher";
  if (!(await confirm({
    title: `Permanently delete ${label}?`,
    message: (
      <>
        <p style={{ margin: "0 0 8px" }}>
          This also <strong>permanently deletes</strong>:
        </p>
        <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
          {impact.assignments_destroyed > 0 && (
            <li>{countLine(impact.assignments_destroyed, "homework", "homeworks")} they created</li>
          )}
          {impact.submissions_destroyed > 0 && (
            <li>{countLine(impact.submissions_destroyed, "student submission", "student submissions")}</li>
          )}
          {impact.grades_destroyed > 0 && (
            <li>{countLine(impact.grades_destroyed, "grade", "grades")}</li>
          )}
        </ul>
        {impact.students_affected > 0 && (
          <p style={{ margin: "0 0 8px" }}>
            That work belongs to{" "}
            <strong>
              {countLine(impact.students_affected, "student", "students")}
            </strong>{" "}
            who are <strong>not</strong> being deleted. Their accounts
            stay; their graded work does not.
          </p>
        )}
        <p style={{ margin: "0 0 8px" }}>
          {isTeacher
            ? "Deactivating instead revokes their access immediately and keeps all of this."
            : "Deactivating instead revokes access and keeps their work."}
        </p>
        <p style={{ margin: 0 }}>This cannot be undone.</p>
      </>
    ),
    confirmLabel: "Delete everything",
    requireTypedConfirmation: label,
  }))) return false;

  await api.deleteUser(userId);
  return true;
}
