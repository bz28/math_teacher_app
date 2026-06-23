import { render, screen, fireEvent } from "@testing-library/react-native";
import { ExtractionConfirmScreen } from "./ExtractionConfirmScreen";
import { flush } from "../test-utils";
import * as api from "../services/api";

jest.mock("../services/api", () => ({
  getSubmission: jest.fn(),
  confirmExtraction: jest.fn(),
  flagExtraction: jest.fn(),
}));

const mockedApi = api as jest.Mocked<typeof api>;

// Mirrors the REAL backend wire shape: a flat list of steps + final answers
// tagged by problem_position, with a numeric confidence. (The chunk-4 bug was
// consuming an invented {problems, overall_confidence} shape — this fixture is
// the regression guard: rendering it must not crash into the ErrorBoundary.)
const SUBMISSION = {
  submission_id: "sub-1",
  submitted_at: "2026-06-01T00:00:00Z",
  is_late: false,
  extraction: {
    steps: [{ step_num: 1, problem_position: 1, latex: "x=2", plain_english: "x equals 2" }],
    final_answers: [{ problem_position: 1, answer_latex: "2", answer_plain: "2" }],
    confidence: 0.9,
  },
  extraction_confirmed_at: null,
  extraction_flagged_at: null,
  integrity_check_enabled: true,
  ai_grading_enabled: true,
};

describe("ExtractionConfirmScreen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the confirm UI from the real {steps, final_answers, confidence} shape", async () => {
    mockedApi.getSubmission.mockResolvedValue(SUBMISSION as never);
    render(<ExtractionConfirmScreen assignmentId="a" onDone={jest.fn()} onIntegrityCheck={jest.fn()} />);

    await flush();
    expect(screen.getByText("Did we read this right?")).toBeTruthy();
    expect(screen.getByText("x equals 2")).toBeTruthy(); // grouped step
    expect(screen.getByText(/Answer: 2/)).toBeTruthy();
  });

  it("confirm routes to the integrity chat when integrity is enabled", async () => {
    mockedApi.getSubmission.mockResolvedValue(SUBMISSION as never);
    mockedApi.confirmExtraction.mockResolvedValue({ status: "ok", already_confirmed: false } as never);
    const onIntegrityCheck = jest.fn();
    render(<ExtractionConfirmScreen assignmentId="a" onDone={jest.fn()} onIntegrityCheck={onIntegrityCheck} />);

    await flush();
    fireEvent.press(screen.getByText("Looks right"));
    await flush();

    expect(mockedApi.confirmExtraction).toHaveBeenCalledWith("sub-1");
    expect(onIntegrityCheck).toHaveBeenCalledWith("sub-1");
  });

  it("acknowledges without a confirm UI when no integrity/grading pipeline runs", async () => {
    mockedApi.getSubmission.mockResolvedValue({
      ...SUBMISSION,
      extraction: null,
      integrity_check_enabled: false,
      ai_grading_enabled: false,
    } as never);
    render(<ExtractionConfirmScreen assignmentId="a" onDone={jest.fn()} onIntegrityCheck={jest.fn()} />);

    await flush();
    expect(screen.getByText("Submitted!")).toBeTruthy();
    expect(screen.queryByText("Did we read this right?")).toBeNull();
  });
});
