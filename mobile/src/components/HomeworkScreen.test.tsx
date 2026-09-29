import { Alert, StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { HomeworkScreen } from "./HomeworkScreen";
import { waitForText } from "../test-utils";
import { colors } from "../theme";
import * as api from "../services/api";

jest.mock("../services/api", () => ({
  getHomework: jest.fn(),
  getSubmission: jest.fn(),
  submitHomework: jest.fn(),
  checkPageOrientation: jest.fn(),
}));
jest.mock("../hooks/useCameraCapture", () => ({
  captureWorkImage: jest.fn(async () => "PHOTO_B64"),
  pickWorkImageFromLibrary: jest.fn(),
  pickWorkPdf: jest.fn(),
}));
jest.mock("../utils/orientationCheckCopy", () => ({
  orientationCheckCopy: jest.fn(async () => "SMALL_B64"),
}));
const mockedApi = api as jest.Mocked<typeof api>;

const problem = (bank_item_id: string, position: number, question: string) => ({
  bank_item_id,
  position,
  question,
  difficulty: "medium",
  approved_variation_count: 0,
  format: "frq",
  mcq_choices: [],
  figure_svg: null,
});

// A graded homework whose feedback payload is out of order and carries a stale
// row: positions are non-sequential (2, 5) so a real position-join is provable
// (index-based labeling could never produce "Problem 5" from two problems).
const GRADED = {
  assignment_id: "hw1",
  course_id: "c1",
  course_name: "Algebra",
  course_subject: "math",
  title: "Fractions practice",
  description: null,
  due_at: null,
  submitted: true,
  grade_published_at: "2026-06-01T00:00:00Z",
  final_score: 73,
  problems: [problem("pa", 2, "Question A"), problem("pb", 5, "Question B")],
  breakdown: [
    { problem_id: "pb", score_status: "full", percent: 100, feedback: "Great work on B" },
    { problem_id: "pa", score_status: "zero", percent: 0, feedback: "Review A" },
    { problem_id: "gone", score_status: "partial", percent: 55, feedback: "Leftover note" },
  ],
};

const colorOf = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style).color;

describe("HomeworkScreen graded breakdown", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.getHomework.mockResolvedValue(GRADED as never);
    mockedApi.getSubmission.mockResolvedValue({ files: [] } as never);
  });

  it("labels each row by the problem's real position, joined on problem_id", async () => {
    render(<HomeworkScreen assignmentId="hw1" onBack={jest.fn()} onSubmitted={jest.fn()} />);

    // The stale row (problem_id no longer in the assignment) gets the fallback.
    expect(await waitForText("Additional feedback")).toBeTruthy();

    // pb is at breakdown index 0 but position 5. "Problem 5" appears twice —
    // once on its problem card, once on its breakdown row — proving the row is
    // labeled by a problem_id -> position join. An index-based label over two
    // breakdown rows could never emit "Problem 5", so it would appear only once.
    expect(screen.getAllByText("Problem 5")).toHaveLength(2);
    expect(screen.getAllByText("Problem 2")).toHaveLength(2);
  });

  it("colors each percent by its score_status, mirroring scoreColor", async () => {
    render(<HomeworkScreen assignmentId="hw1" onBack={jest.fn()} onSubmitted={jest.fn()} />);
    await waitForText("Additional feedback");

    expect(colorOf("100%")).toBe(colors.success); // full
    expect(colorOf("55%")).toBe(colors.textSecondary); // partial
    expect(colorOf("0%")).toBe(colors.error); // zero
  });
});

describe("HomeworkScreen sideways pages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.getHomework.mockResolvedValue({
      ...GRADED,
      submitted: false,
      grade_published_at: null,
      final_score: null,
      breakdown: null,
    } as never);
    mockedApi.submitHomework.mockResolvedValue({} as never);
    // "Add your work" opens a native action sheet; take the photo option.
    jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === "Take a photo")?.onPress?.();
    });
  });

  async function addPhoto() {
    render(<HomeworkScreen assignmentId="hw1" onBack={jest.fn()} onSubmitted={jest.fn()} />);
    await fireEvent.press(await waitForText("Add your work"));
  }

  it("nudges a page the check reads as sideways, until it gets a quarter turn", async () => {
    mockedApi.checkPageOrientation.mockResolvedValue({ sideways: true });
    await addPhoto();

    expect(await waitForText(/Page 1 looks sideways/)).toBeTruthy();
    expect(mockedApi.checkPageOrientation).toHaveBeenCalledWith("SMALL_B64");

    const rotateBtn = screen.getByLabelText("Rotate page a quarter turn clockwise");
    await fireEvent.press(rotateBtn);
    expect(screen.queryByText(/looks sideways/)).toBeNull();
    // A half turn leaves the writing running up and down again.
    await fireEvent.press(rotateBtn);
    expect(screen.getByText(/Page 1 looks sideways/)).toBeTruthy();
    await fireEvent.press(rotateBtn);

    await fireEvent.press(screen.getByText("Review & turn in 1 page"));
    await fireEvent.press(screen.getByText("Turn it in"));
    expect(mockedApi.submitHomework).toHaveBeenCalledWith("hw1", ["PHOTO_B64"], [270]);
  });

  it("shows no nudge when the check is unsure or fails", async () => {
    mockedApi.checkPageOrientation.mockRejectedValue(new Error("offline"));
    await addPhoto();
    expect(await screen.findByLabelText("Rotate page a quarter turn clockwise")).toBeTruthy();
    expect(screen.queryByText(/looks sideways/)).toBeNull();
  });
});
