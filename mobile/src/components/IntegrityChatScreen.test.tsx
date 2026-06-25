import { render, screen, fireEvent } from "@testing-library/react-native";
import { IntegrityChatScreen } from "./IntegrityChatScreen";
import { flush, waitForText } from "../test-utils";
import * as api from "../services/api";

jest.mock("../services/api", () => ({
  getIntegrityState: jest.fn(),
  postIntegrityTurn: jest.fn(),
  MIN_INTEGRITY_MESSAGE_CHARS: 5,
}));
const mockedApi = api as jest.Mocked<typeof api>;

const STATE = {
  submission_id: "sub-1",
  overall_status: "awaiting_student",
  disposition: null,
  problems: [{ problem_id: "p1", hw_position: 3, status: "pending", question: "What is 2+2?" }],
  transcript: [
    { ordinal: 0, role: "agent", content: "How did you get your answer?", created_at: "x", is_variant_probe: false },
  ],
};

describe("IntegrityChatScreen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the sampled problem and the agent's opening turn", async () => {
    mockedApi.getIntegrityState.mockResolvedValue(STATE as never);
    render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);

    expect(await waitForText("Problem 3")).toBeTruthy();
    expect(screen.getByText("What is 2+2?")).toBeTruthy();
    expect(screen.getByText("How did you get your answer?")).toBeTruthy();
  });

  it("posts a student turn and renders the agent reply", async () => {
    mockedApi.getIntegrityState.mockResolvedValue(STATE as never);
    mockedApi.postIntegrityTurn.mockResolvedValue({
      ...STATE,
      overall_status: "in_progress",
      transcript: [
        ...STATE.transcript,
        { ordinal: 1, role: "student", content: "I added two and two", created_at: "x", is_variant_probe: false },
        { ordinal: 2, role: "agent", content: "Nice — why does that work?", created_at: "x", is_variant_probe: false },
      ],
    } as never);
    render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);

    await waitForText("How did you get your answer?");
    fireEvent.changeText(screen.getByPlaceholderText("Explain how you solved it…"), "I added two and two");
    await flush(); // let the input state update before send reads it
    fireEvent.press(screen.getByLabelText("Send"));
    await flush();

    expect(mockedApi.postIntegrityTurn).toHaveBeenCalledWith(
      "sub-1",
      "I added two and two",
      expect.any(Number),
      expect.objectContaining({ device_type: "mobile" }),
    );
    expect(screen.getByText("Nice — why does that work?")).toBeTruthy();
  });
});
