import assert from "node:assert/strict";
import { test } from "node:test";
import { breadcrumbTrail } from "./breadcrumb-trail.ts";

test("the last crumb is the current page; the others link up", () => {
  assert.deepEqual(
    breadcrumbTrail([
      { label: "Algebra", href: "/c" },
      { label: "HW 1", href: "/h" },
      { label: "Period 1" },
    ]),
    [
      { label: "Algebra", href: "/c", current: false },
      { label: "HW 1", href: "/h", current: false },
      { label: "Period 1", href: null, current: true },
    ],
  );
});

test("while the current page's name is missing, the crumb before it stays a link", () => {
  assert.deepEqual(
    breadcrumbTrail([
      { label: "Algebra", href: "/c" },
      { label: "Grades", href: "/g" },
      { label: "" },
    ]),
    [
      { label: "Algebra", href: "/c", current: false },
      { label: "Grades", href: "/g", current: false },
    ],
  );
});

test("a crumb not loaded yet is left out", () => {
  assert.deepEqual(breadcrumbTrail([{ label: "", href: "/c" }, { label: "HW 1" }]), [
    { label: "HW 1", href: null, current: true },
  ]);
});
