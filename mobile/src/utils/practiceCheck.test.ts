import { isAnswerCorrect, normalizeAnswer, uniqueCourses } from "./practiceCheck";

describe("normalizeAnswer", () => {
  it("trims, collapses whitespace, lowercases", () => {
    expect(normalizeAnswer("  X  =  2 ")).toBe("x = 2");
    expect(normalizeAnswer("TRUE")).toBe("true");
  });
});

describe("isAnswerCorrect", () => {
  it("matches case/whitespace-insensitively", () => {
    expect(isAnswerCorrect("x = 2", "X=2")).toBe(false); // spacing differs meaningfully
    expect(isAnswerCorrect(" 42 ", "42")).toBe(true);
    expect(isAnswerCorrect("Yes", "yes")).toBe(true);
  });

  it("is false for empty input or missing answer", () => {
    expect(isAnswerCorrect("", "42")).toBe(false);
    expect(isAnswerCorrect("42", null)).toBe(false);
    expect(isAnswerCorrect("42", undefined)).toBe(false);
  });
});

describe("uniqueCourses", () => {
  it("dedupes by course_id, keeping first", () => {
    const rows = [
      { course_id: "c1", section_id: "s1" },
      { course_id: "c1", section_id: "s2" },
      { course_id: "c2", section_id: "s3" },
    ];
    expect(uniqueCourses(rows).map((c) => c.course_id)).toEqual(["c1", "c2"]);
  });
});
