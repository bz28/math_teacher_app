import { meetsIntegrityMinimum } from "./integrityMinimum";

describe("meetsIntegrityMinimum", () => {
  it("before the stuck tap: plain 5-char floor only", () => {
    expect(meetsIntegrityMinimum("idk", false)).toBe(false);
    expect(meetsIntegrityMinimum("     ", false)).toBe(false);
    expect(meetsIntegrityMinimum("x=4", false)).toBe(false);
    expect(meetsIntegrityMinimum("I did", false)).toBe(true);
  });

  it("after the stuck tap: 3+ words or 12+ chars", () => {
    expect(meetsIntegrityMinimum("I did", true)).toBe(false);
    expect(meetsIntegrityMinimum("no idea", true)).toBe(false);
    expect(meetsIntegrityMinimum("dunno lol", true)).toBe(false);
    expect(meetsIntegrityMinimum("  no   idea  ", true)).toBe(false);
    expect(meetsIntegrityMinimum("abcdefghijk", true)).toBe(false);
    expect(meetsIntegrityMinimum("x = 4", true)).toBe(true);
    expect(meetsIntegrityMinimum("abcdefghijkl", true)).toBe(true);
    expect(meetsIntegrityMinimum("factorization", true)).toBe(true);
  });
});
