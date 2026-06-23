import { confidenceBand, groupExtraction } from "./extraction";
import type { Extraction } from "../services/api";

const ex = (over: Partial<Extraction>): Extraction => ({
  steps: [],
  final_answers: [],
  confidence: 1,
  ...over,
});

describe("groupExtraction", () => {
  it("buckets steps and final answers by problem_position, ascending", () => {
    const groups = groupExtraction(
      ex({
        steps: [
          { step_num: 1, problem_position: 2, latex: "b", plain_english: "B" },
          { step_num: 1, problem_position: 1, latex: "a", plain_english: "A" },
          { step_num: 2, problem_position: 1, latex: "a2", plain_english: "A2" },
        ],
        final_answers: [{ problem_position: 1, answer_latex: "x", answer_plain: "x" }],
      }),
    );
    expect(groups.map((g) => g.position)).toEqual([1, 2]);
    expect(groups[0].steps).toHaveLength(2);
    expect(groups[0].finalAnswer?.answer_plain).toBe("x");
    expect(groups[1].steps).toHaveLength(1);
    expect(groups[1].finalAnswer).toBeNull();
  });

  it("puts unattributed (null position) work last", () => {
    const groups = groupExtraction(
      ex({
        steps: [
          { step_num: 1, problem_position: null, latex: "s", plain_english: "scratch" },
          { step_num: 1, problem_position: 1, latex: "a", plain_english: "A" },
        ],
      }),
    );
    expect(groups.map((g) => g.position)).toEqual([1, null]);
  });

  it("handles an empty extraction", () => {
    expect(groupExtraction(ex({}))).toEqual([]);
  });
});

describe("confidenceBand", () => {
  it("bands at 0.8 and 0.5", () => {
    expect(confidenceBand(0.95)).toBe("high");
    expect(confidenceBand(0.8)).toBe("high");
    expect(confidenceBand(0.7)).toBe("medium");
    expect(confidenceBand(0.5)).toBe("medium");
    expect(confidenceBand(0.4)).toBe("low");
    expect(confidenceBand(0)).toBe("low");
  });
});
