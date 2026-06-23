import { render, screen, fireEvent } from "@testing-library/react-native";
import { SchoolHomeScreen } from "./SchoolHomeScreen";
import { waitForText } from "../test-utils";
import * as api from "../services/api";

jest.mock("../services/api", () => ({ getSchoolDashboard: jest.fn() }));
const mockedApi = api as jest.Mocked<typeof api>;

const DASHBOARD = {
  first_name: "Sam",
  due_this_week: [
    {
      assignment_id: "hw1",
      title: "Fractions practice",
      type: "homework",
      due_at: null,
      course_id: "c1",
      course_name: "Algebra",
      section_name: "Period 1",
      status: "not_started",
      is_late: false,
    },
  ],
  overdue: [],
  in_review: [],
  recently_graded: [],
};

describe("SchoolHomeScreen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders dashboard sections and opens an assignment on tap", async () => {
    mockedApi.getSchoolDashboard.mockResolvedValue(DASHBOARD as never);
    const onOpenAssignment = jest.fn();
    render(<SchoolHomeScreen onJoinClass={jest.fn()} onOpenAssignment={onOpenAssignment} />);

    expect(await waitForText("Hi, Sam.")).toBeTruthy();
    expect(screen.getByText("Due this week")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Fractions practice"));
    expect(onOpenAssignment).toHaveBeenCalledWith("hw1");
  });

  it("shows the all-caught-up empty state when there's nothing due", async () => {
    mockedApi.getSchoolDashboard.mockResolvedValue({
      ...DASHBOARD,
      due_this_week: [],
    } as never);
    render(<SchoolHomeScreen onJoinClass={jest.fn()} onOpenAssignment={jest.fn()} />);

    expect(await waitForText("You're all caught up")).toBeTruthy();
  });
});
