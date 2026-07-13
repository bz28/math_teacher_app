import { render, screen, fireEvent } from "@testing-library/react-native";
import { GradesScreen } from "./GradesScreen";
import { waitForText } from "../test-utils";
import * as api from "../services/api";
import { useSchoolCacheStore } from "../stores/schoolCache";

jest.mock("../services/api", () => ({ getSchoolGrades: jest.fn() }));
const mockedApi = api as jest.Mocked<typeof api>;

const GRADES = [
  {
    assignment_id: "hw1",
    course_id: "c1",
    course_name: "Algebra",
    final_score: 92,
    published_at: "2026-06-01T00:00:00Z",
    section_name: "Period 1",
    title: "Fractions practice",
  },
];

describe("GradesScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSchoolCacheStore.setState({ entries: {} });
  });

  it("opens the graded homework when a grade row is tapped", async () => {
    mockedApi.getSchoolGrades.mockResolvedValue({ grades: GRADES } as never);
    const onOpenGrade = jest.fn();
    render(<GradesScreen onOpenGrade={onOpenGrade} />);

    expect(await waitForText("Fractions practice")).toBeTruthy();

    fireEvent.press(screen.getByText("Fractions practice"));
    expect(onOpenGrade).toHaveBeenCalledWith("hw1");
  });

  it("shows the empty state when there are no grades", async () => {
    mockedApi.getSchoolGrades.mockResolvedValue({ grades: [] } as never);
    render(<GradesScreen onOpenGrade={jest.fn()} />);

    expect(await waitForText("No grades yet")).toBeTruthy();
  });
});
