import { answerPreview, FLAG_NOTE_STARTERS, flagNoteReady, withStarter } from "./extractionFlag";

describe("extractionFlag", () => {
  it("needs a real pointer in the whole-reading note", () => {
    expect(flagNoteReady("")).toBe(false);
    expect(flagNoteReady("   ")).toBe(false);
    expect(flagNoteReady("no")).toBe(false);
    expect(flagNoteReady("P9 is 65")).toBe(true);
    for (const s of FLAG_NOTE_STARTERS) expect(flagNoteReady(s)).toBe(true);
  });

  it("fills, appends, and never repeats a starter", () => {
    expect(withStarter("", "Most lines are wrong")).toBe("Most lines are wrong");
    expect(withStarter("Problem 3 is off", "Most lines are wrong")).toBe(
      "Problem 3 is off. Most lines are wrong",
    );
    expect(withStarter("Problem 3 is off!", "Most lines are wrong")).toBe(
      "Problem 3 is off! Most lines are wrong",
    );
    expect(withStarter("Most lines are wrong", "Most lines are wrong")).toBe("Most lines are wrong");
  });

  it("previews the answer we read, plain text first", () => {
    expect(answerPreview({ answer_plain: "63", answer_latex: "63" })).toBe("63");
    expect(answerPreview({ answer_plain: " ", answer_latex: "\\frac{1}{2}" })).toBe("\\frac{1}{2}");
    expect(answerPreview({ answer_plain: null, answer_latex: null })).toBeNull();
    expect(answerPreview(null)).toBeNull();
  });
});
