import { render, screen, fireEvent } from "@testing-library/react-native";
import { SchoolHomeScreen } from "./SchoolHomeScreen";
import { waitForText } from "../test-utils";
import * as api from "../services/api";
import { useSchoolCacheStore } from "../stores/schoolCache";

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
  beforeEach(() => {
    jest.clearAllMocks();
    // The tab cache is a module singleton — clear it so each test starts cold.
    useSchoolCacheStore.setState({ entries: {} });
  });

  it("renders dashboard sections and opens an assignment on tap", async () => {
    mockedApi.getSchoolDashboard.mockResolvedValue(DASHBOARD as never);
    const onOpenAssignment = jest.fn();
    render(<SchoolHomeScreen onJoinClass={jest.fn()} onOpenAssignment={onOpenAssignment} />);

    expect(await waitForText("Hi, Sam.")).toBeTruthy();
    expect(screen.getByText("Due this week")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Fractions practice"));
    expect(onOpenAssignment).toHaveBeenCalledWith("hw1");
  });

  it("leads with turned-in work that has one step left", async () => {
    const row = DASHBOARD.due_this_week[0];
    mockedApi.getSchoolDashboard.mockResolvedValue({
      ...DASHBOARD,
      due_this_week: [],
      in_review: [
        { ...row, assignment_id: "hw2", title: "Needs a confirm", status: "submitted", next_step: "confirm_reading" },
        { ...row, assignment_id: "hw3", title: "Just waiting", status: "submitted", next_step: null },
      ],
    } as never);
    const onOpenAssignment = jest.fn();
    render(<SchoolHomeScreen onJoinClass={jest.fn()} onOpenAssignment={onOpenAssignment} />);

    expect(await waitForText("One more step")).toBeTruthy();
    expect(screen.getByText("Confirm your reading")).toBeTruthy();
    // The rest stay under In review, not duplicated into the step list.
    expect(screen.getByText("In review")).toBeTruthy();
    expect(screen.getAllByText("Needs a confirm")).toHaveLength(1);
    fireEvent.press(screen.getByLabelText("Needs a confirm"));
    expect(onOpenAssignment).toHaveBeenCalledWith("hw2");
  });

  it("shows the all-caught-up empty state when there's nothing due", async () => {
    mockedApi.getSchoolDashboard.mockResolvedValue({
      ...DASHBOARD,
      due_this_week: [],
    } as never);
    render(<SchoolHomeScreen onJoinClass={jest.fn()} onOpenAssignment={jest.fn()} />);

    expect(await waitForText("You're all caught up")).toBeTruthy();
  });

  it("hydrates from cache on a tab revisit without waiting on the refetch", async () => {
    mockedApi.getSchoolDashboard.mockResolvedValue(DASHBOARD as never);
    const view = await render(
      <SchoolHomeScreen onJoinClass={jest.fn()} onOpenAssignment={jest.fn()} />,
    );
    expect(await waitForText("Fractions practice")).toBeTruthy();
    await view.unmount();

    // Remount = switching back to this tab. The background refetch now hangs
    // forever; the cached data must still render (no skeleton, no wait on the
    // network) — proving the tab hydrates from the store, not a fresh fetch.
    mockedApi.getSchoolDashboard.mockReturnValue(new Promise(() => {}) as never);
    await render(<SchoolHomeScreen onJoinClass={jest.fn()} onOpenAssignment={jest.fn()} />);
    expect(screen.getByText("Fractions practice")).toBeTruthy();
  });
});
