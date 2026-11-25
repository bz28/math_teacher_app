// node --experimental-strip-types --test src/lib/home-path.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homePathFor } from "./home-path.ts";

describe("homePathFor", () => {
  it("sends teachers to their course portal", () => {
    assert.equal(homePathFor("teacher"), "/school/teacher");
  });

  it("sends every student — enrolled or not — to the school-student portal", () => {
    assert.equal(homePathFor("student"), "/school/student");
  });

  it("sends admins to the teacher portal, never the student portal", () => {
    assert.equal(homePathFor("admin"), "/school/teacher");
  });

  it("never points at the hidden self-study home", () => {
    for (const role of ["teacher", "student", "admin", null, undefined]) {
      assert.notEqual(homePathFor(role), "/home");
    }
  });
});
