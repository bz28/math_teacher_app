import { render, screen, fireEvent } from "@testing-library/react-native";
import { ExtractionConfirmScreen } from "./ExtractionConfirmScreen";
import { flush, waitForText } from "../test-utils";
import * as api from "../services/api";

jest.mock("../services/api", () => ({
  getSubmission: jest.fn(),
  confirmExtraction: jest.fn(),
  flagExtraction: jest.fn(),
  FLAG_NOTE_MAX: 500,
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

    expect(await waitForText("Did we read this right?")).toBeTruthy();
    // Steps + final answer are editable fields, pre-filled with the OCR text.
    expect(screen.getByDisplayValue("x equals 2")).toBeTruthy();
    expect(screen.getByDisplayValue("2")).toBeTruthy();
  });

  it("confirm with no edits routes to the integrity chat", async () => {
    mockedApi.getSubmission.mockResolvedValue(SUBMISSION as never);
    mockedApi.confirmExtraction.mockResolvedValue({ status: "ok", already_confirmed: false } as never);
    const onIntegrityCheck = jest.fn();
    render(<ExtractionConfirmScreen assignmentId="a" onDone={jest.fn()} onIntegrityCheck={onIntegrityCheck} />);

    fireEvent.press(await waitForText("Looks right"));
    await flush();

    expect(mockedApi.confirmExtraction).toHaveBeenCalledWith("sub-1", {});
    expect(onIntegrityCheck).toHaveBeenCalledWith("sub-1");
  });

  it("confirm with the check off (AI grading on) leaves the screen — confirming is the last step", async () => {
    mockedApi.getSubmission.mockResolvedValue({ ...SUBMISSION, integrity_check_enabled: false } as never);
    mockedApi.confirmExtraction.mockResolvedValue({ status: "ok", already_confirmed: false } as never);
    const onDone = jest.fn();
    const onIntegrityCheck = jest.fn();
    render(<ExtractionConfirmScreen assignmentId="a" onDone={onDone} onIntegrityCheck={onIntegrityCheck} />);

    fireEvent.press(await waitForText("Looks right"));
    await flush();

    expect(mockedApi.confirmExtraction).toHaveBeenCalledWith("sub-1", {});
    expect(onDone).toHaveBeenCalled();
    expect(onIntegrityCheck).not.toHaveBeenCalled();
  });

  it("sends OCR corrections, keyed by position:step_num, on confirm", async () => {
    mockedApi.getSubmission.mockResolvedValue(SUBMISSION as never);
    mockedApi.confirmExtraction.mockResolvedValue({ status: "ok", already_confirmed: false } as never);
    render(<ExtractionConfirmScreen assignmentId="a" onDone={jest.fn()} onIntegrityCheck={jest.fn()} />);

    await waitForText("Did we read this right?");
    fireEvent.changeText(screen.getByDisplayValue("x equals 2"), "x equals 3");
    await flush();
    fireEvent.press(screen.getByText("Looks right"));
    await flush();

    expect(mockedApi.confirmExtraction).toHaveBeenCalledWith("sub-1", { "1:1": "x equals 3" });
  });

  it("sends a final-answer correction keyed position:final", async () => {
    mockedApi.getSubmission.mockResolvedValue(SUBMISSION as never);
    mockedApi.confirmExtraction.mockResolvedValue({ status: "ok", already_confirmed: false } as never);
    render(<ExtractionConfirmScreen assignmentId="a" onDone={jest.fn()} onIntegrityCheck={jest.fn()} />);

    await waitForText("Did we read this right?");
    fireEvent.changeText(screen.getByDisplayValue("2"), "5");
    await flush();
    fireEvent.press(screen.getByText("Looks right"));
    await flush();

    expect(mockedApi.confirmExtraction).toHaveBeenCalledWith("sub-1", { "1:final": "5" });
  });

  it("picking the problem that looks wrong opens fix mode on it instead of flagging", async () => {
    mockedApi.getSubmission.mockResolvedValue(SUBMISSION as never);
    mockedApi.confirmExtraction.mockResolvedValue({ status: "ok", already_confirmed: false } as never);
    render(<ExtractionConfirmScreen assignmentId="a" onDone={jest.fn()} onIntegrityCheck={jest.fn()} />);

    fireEvent.press(await waitForText("Something looks wrong"));
    expect(await waitForText("Which problem looks wrong?")).toBeTruthy();
    // Sending it to the teacher is quieter but always there, as a real button.
    expect(screen.getByLabelText("The whole reading is wrong")).toBeTruthy();
    // Each tile carries the answer we read, so the misread is spotted here.
    fireEvent.press(screen.getByLabelText("Problem 1, we read 2. Fix it."));

    expect(await waitForText("Fix the line on Problem 1 that's wrong, then confirm.")).toBeTruthy();
    expect(screen.queryByText("Which problem looks wrong?")).toBeNull();
    expect(mockedApi.flagExtraction).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByDisplayValue("x equals 2"), "x equals 3");
    await flush();
    fireEvent.press(screen.getByText("Looks right"));
    await flush();
    expect(mockedApi.confirmExtraction).toHaveBeenCalledWith("sub-1", { "1:1": "x equals 3" });
  });

  it("'The whole reading is wrong' needs a note, then sends it and any edits with the flag", async () => {
    mockedApi.getSubmission.mockResolvedValue(SUBMISSION as never);
    mockedApi.flagExtraction.mockResolvedValue({ status: "ok", already_flagged: false } as never);
    const onDone = jest.fn();
    render(<ExtractionConfirmScreen assignmentId="a" onDone={onDone} onIntegrityCheck={jest.fn()} />);

    await waitForText("Did we read this right?");
    fireEvent.changeText(screen.getByDisplayValue("x equals 2"), "x equals 3");
    await flush();
    fireEvent.press(screen.getByText("Something looks wrong"));
    fireEvent.press(await waitForText("The whole reading is wrong"));
    expect(await waitForText("The line you fixed will go too.")).toBeTruthy();
    // No note yet: the teacher would get no pointer, so nothing is sent.
    fireEvent.press(screen.getByText("Send to my teacher"));
    await flush();
    expect(mockedApi.flagExtraction).not.toHaveBeenCalled();
    // A starter fills it in one tap; the student can add to it.
    fireEvent.press(screen.getByLabelText("Most lines are wrong"));
    await flush();
    fireEvent.changeText(
      screen.getByLabelText("What's wrong with the reading?"),
      "Most lines are wrong. it read my 7s as 1s",
    );
    await flush();
    fireEvent.press(screen.getByText("Send to my teacher"));
    await flush();

    expect(mockedApi.flagExtraction).toHaveBeenCalledWith("sub-1", {
      note: "Most lines are wrong. it read my 7s as 1s",
      edits: { "1:1": "x equals 3" },
    });
    expect(mockedApi.confirmExtraction).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("a line typed back to what was read isn't sent as an edit", async () => {
    mockedApi.getSubmission.mockResolvedValue(SUBMISSION as never);
    mockedApi.confirmExtraction.mockResolvedValue({ status: "ok", already_confirmed: false } as never);
    render(<ExtractionConfirmScreen assignmentId="a" onDone={jest.fn()} onIntegrityCheck={jest.fn()} />);

    await waitForText("Did we read this right?");
    fireEvent.changeText(screen.getByDisplayValue("x equals 2"), "x equals 3");
    await flush();
    fireEvent.changeText(screen.getByDisplayValue("x equals 3"), "x equals 2 ");
    await flush();
    fireEvent.press(screen.getByText("Looks right"));
    await flush();

    expect(mockedApi.confirmExtraction).toHaveBeenCalledWith("sub-1", {});
  });

  it("a failed flag says so instead of failing silently", async () => {
    mockedApi.getSubmission.mockResolvedValue(SUBMISSION as never);
    mockedApi.flagExtraction.mockRejectedValue(new Error("Request failed (500)") as never);
    const onDone = jest.fn();
    render(<ExtractionConfirmScreen assignmentId="a" onDone={onDone} onIntegrityCheck={jest.fn()} />);

    fireEvent.press(await waitForText("Something looks wrong"));
    fireEvent.press(await waitForText("The whole reading is wrong"));
    fireEvent.press(await waitForText("My photos are hard to read"));
    fireEvent.press(await waitForText("Send to my teacher"));

    expect(await waitForText("Couldn't send it to your teacher. Try again.")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("skips straight to the note when there's no line to fix", async () => {
    mockedApi.getSubmission.mockResolvedValue({
      ...SUBMISSION,
      extraction: { steps: [], final_answers: [], confidence: 0.3 },
    } as never);
    render(<ExtractionConfirmScreen assignmentId="a" onDone={jest.fn()} onIntegrityCheck={jest.fn()} />);

    fireEvent.press(await waitForText("Something looks wrong"));
    expect(await waitForText("What's wrong with the reading?")).toBeTruthy();
    expect(screen.queryByText("Which problem looks wrong?")).toBeNull();
  });

  it("an answer slot that came back empty isn't a line to fix", async () => {
    // The "which problem" step would open with no tiles at all.
    mockedApi.getSubmission.mockResolvedValue({
      ...SUBMISSION,
      extraction: {
        steps: [],
        final_answers: [{ problem_position: 1, answer_latex: "", answer_plain: "" }],
        confidence: 0.3,
      },
    } as never);
    render(<ExtractionConfirmScreen assignmentId="a" onDone={jest.fn()} onIntegrityCheck={jest.fn()} />);

    fireEvent.press(await waitForText("Something looks wrong"));
    expect(await waitForText("What's wrong with the reading?")).toBeTruthy();
    expect(screen.queryByText("Which problem looks wrong?")).toBeNull();
  });

  it("shows a source-photo strip of the submitted pages to compare against", async () => {
    mockedApi.getSubmission.mockResolvedValue({
      ...SUBMISSION,
      files: [
        { data: "QQ==", media_type: "image/jpeg" },
        { data: "QQ==", media_type: "application/pdf", filename: "work.pdf" },
      ],
    } as never);
    render(<ExtractionConfirmScreen assignmentId="a" onDone={jest.fn()} onIntegrityCheck={jest.fn()} />);

    expect(await waitForText("Your work · tap to enlarge")).toBeTruthy();
    expect(screen.getByLabelText("View page 1")).toBeTruthy();
    expect(screen.getByLabelText("View page 2")).toBeTruthy();
  });

  it("acknowledges without a confirm UI when no integrity/grading pipeline runs", async () => {
    mockedApi.getSubmission.mockResolvedValue({
      ...SUBMISSION,
      extraction: null,
      integrity_check_enabled: false,
      ai_grading_enabled: false,
    } as never);
    render(<ExtractionConfirmScreen assignmentId="a" onDone={jest.fn()} onIntegrityCheck={jest.fn()} />);

    expect(await waitForText("Submitted!")).toBeTruthy();
    expect(screen.queryByText("Did we read this right?")).toBeNull();
  });
});
