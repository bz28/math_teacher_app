/**
 * Rows per page for every list in the console.
 *
 * This used to be a per-file constant — eight of them, at 5, 25 and 50 —
 * plus four inline `pageSize={25}` literals, so "how much does a page
 * show" answered differently on every tab and half the tables never
 * paged at all. One value, imported everywhere, is the whole practice.
 *
 * Two shapes consume it, and the split matters:
 *
 *   Server-paged  — fetch `limit: PAGE_SIZE` with an offset and render
 *                   `<Pagination>` next to the table. The table receives
 *                   exactly one page, so `DataTable`'s own pager stays
 *                   dormant and there is never a second one on screen.
 *   Client-paged  — fetch the set (a generous `limit`, or an unpaged
 *                   endpoint) and let `DataTable` page it. Sorting and
 *                   search then run across everything, not a prefix.
 */
export const PAGE_SIZE = 5;
