import { normalizeJoinCode } from "./joinCode";

describe("normalizeJoinCode", () => {
  it("uppercases and strips all whitespace", () => {
    expect(normalizeJoinCode("ab c12 ")).toBe("ABC12");
    expect(normalizeJoinCode("  xyz9  ")).toBe("XYZ9");
    expect(normalizeJoinCode("a\tb\nc")).toBe("ABC");
  });

  it("leaves an already-clean code unchanged", () => {
    expect(normalizeJoinCode("ABC12")).toBe("ABC12");
  });

  it("handles empty input", () => {
    expect(normalizeJoinCode("")).toBe("");
    expect(normalizeJoinCode("   ")).toBe("");
  });
});
