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
 *                   beside the table, passing `unpaged` to `DataTable` so
 *                   only one pager exists. Don't rely on the fetch limit
 *                   matching `DataTable`'s page size to keep its pager
 *                   quiet: that invariant breaks the first time someone
 *                   changes one number, and breaks as a second pager.
 *   Client-paged  — fetch the set and let `DataTable` page it, so sorting
 *                   and search run over everything rather than a prefix.
 */

/** Panels inside a detail page — a teacher's timeline, generations, roster. */
export const PAGE_SIZE = 5;

/** Full-page operator boards — users, audit log, the quality boards. */
export const BOARD_PAGE_SIZE = 25;
