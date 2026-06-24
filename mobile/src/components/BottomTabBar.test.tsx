import { SCHOOL_TABS, PERSONAL_TABS } from "./BottomTabBar";

describe("tab sets", () => {
  it("school students get a classroom-only tab set — no open Study tools", () => {
    // The Study tab is the personal AI tutor; giving it to school students
    // lets them ask for a homework answer and submit it on the same app.
    // Keep it OUT of the school set (matches web's gating).
    expect(SCHOOL_TABS.map((t) => t.key)).toEqual(["school-home", "grades", "account"]);
    expect(SCHOOL_TABS.map((t) => t.key)).not.toContain("solve");
  });

  it("personal learners keep the full study tab set", () => {
    expect(PERSONAL_TABS.map((t) => t.key)).toEqual(["solve", "history", "review", "account"]);
  });
});
