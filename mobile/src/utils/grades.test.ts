import { averageScore, scoreTone } from "./grades";

describe("scoreTone", () => {
  it("bands at 80 and 60 (inclusive lower bounds)", () => {
    expect(scoreTone(100)).toBe("strong");
    expect(scoreTone(80)).toBe("strong");
    expect(scoreTone(79)).toBe("average");
    expect(scoreTone(60)).toBe("average");
    expect(scoreTone(59)).toBe("struggling");
    expect(scoreTone(0)).toBe("struggling");
  });
});

describe("averageScore", () => {
  it("returns null with no scores", () => {
    expect(averageScore([])).toBeNull();
  });

  it("rounds the mean", () => {
    expect(averageScore([100, 90])).toBe(95);
    expect(averageScore([80, 81, 83])).toBe(81); // 81.33 -> 81
    expect(averageScore([70, 75])).toBe(73); // 72.5 -> 73
  });
});
