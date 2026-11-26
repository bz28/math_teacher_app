

// ── Keyboard grading — focus-safety helpers ─────────────────────────
//
// The grading shortcuts (1/2/3, j/k, Enter…) live on a document-level
// listener so they work no matter where focus sits in the problems
// pane. That power makes guarding against accidental hijacks the whole
// game: a teacher typing "2/3" in a feedback box, or a percent into the
// partial input, must NEVER trip a grade shortcut.
//
// `isTypingTarget` is the gate — when the active element is any text
// surface (input, textarea, select, or contenteditable) the global
// handler bails entirely. We read `document.activeElement` rather than
// the event target because the listener is global and we care about
// where focus actually *is*, not where the key originated.
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
}

// Any open modal on this page renders a `[role="dialog"]` (the shared
// Modal — publish/regrade confirms — plus the verdict-legend, integrity
// conversation, and image lightbox). They're all conditionally rendered,
// so a match means a dialog is genuinely open. While one is, the grading
// shortcuts must NOT fire — otherwise 1/2/3 would grade the problem
// *behind* the dialog and Enter/→ would switch students underneath a
// publish/regrade confirm. The dialog owns the keyboard until it closes.
export function isDialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null;
}

// `isActionableTarget` distinguishes a focused button/link (which
// handles its own Enter/Space activation) from a focused problem row
// (an inert tabIndex=-1 div). We only treat Enter as "next student"
// when focus is NOT on an actionable control, so pressing Enter on a
// focused grade button activates that button instead of double-firing
// a student advance.
export function isActionableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "BUTTON" || tag === "A") return true;
  return el.getAttribute("role") === "button";
}
