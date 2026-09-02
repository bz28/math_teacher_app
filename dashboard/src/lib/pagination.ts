/**
 * How much of a list the console shows at once.
 *
 * This used to be a per-file constant — eight of them, at 5, 25 and 50 —
 * plus four inline `pageSize={25}` literals, so "how much does a page
 * show" answered differently on every tab and half the tables never
 * paged at all. Two named sizes, imported everywhere, replace all twelve.
 *
 * The split is the job the table is doing, not the screen it is on:
 *
 *   A PANEL sits inside a detail page, answering "what did this teacher
 *   just do" — you read the top of it and move on. Small is right; a tall
 *   panel buries whatever comes after it.
 *
 *   A BOARD is the page. Its whole job is one table you scan, filter and
 *   page through, and the sizes have to respect that a real one is long:
 *   solution quality holds 1,280 rows here, which at a panel's size would
 *   be 256 pages behind First/Prev/Next/Last with no page jump.
 *
 * Two consumers, and the shape matters:
 *
 *   Server-paged  — fetch `limit` + `offset` and render `<Pagination>`
 *                   beside the table, passing `serverPaged` to `DataTable`.
 *                   That turns off both its pager and its sort: one page
 *                   sorted client-side ranks the handful on screen under a
 *                   caret claiming it ranked the set. Don't reach for
 *                   `unpaged` here — it stops the pager but leaves the
 *                   sort — and don't rely on the fetch limit matching
 *                   `DataTable`'s page size to keep the pager quiet, which
 *                   breaks as a second pager the moment either changes.
 *                   Pass `error` and `onRetry` unconditionally too: withheld
 *                   once a page has loaded, a failed fetch leaves the
 *                   previous page's rows under the new page's label.
 *   Client-paged  — fetch the set and let `DataTable` page it, so sorting
 *                   and search run over everything rather than a prefix.
 */

/** Panels inside a detail page — a teacher's timeline, generations, roster. */
export const PAGE_SIZE = 5;

/** Full-page operator boards — users, audit log, the quality boards. */
export const BOARD_PAGE_SIZE = 25;
