/**
 * "Skip to main content" link — the first focusable child of a layout
 * root. Visually hidden until focused, then it surfaces so a keyboard
 * user can jump straight past the nav to `#main-content` instead of
 * Tabbing through the whole sidebar/top-bar on every page.
 *
 * Every layout that renders a `<main id="main-content">` should render
 * this as its first child (StudentLayout, TeacherLayout,
 * SchoolStudentLayout).
 */
export function SkipToMainLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[--radius-sm] focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
    >
      Skip to main content
    </a>
  );
}
