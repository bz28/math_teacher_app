import { render, screen, fireEvent, act } from "@testing-library/react-native";
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

  it("optimistically echoes the student's message before the reply lands", async () => {
    mockedApi.getIntegrityState.mockResolvedValue(STATE as never);
    let resolveTurn: (v: unknown) => void = () => {};
    mockedApi.postIntegrityTurn.mockReturnValue(
      new Promise((res) => {
        resolveTurn = res;
      }) as never,
    );
    render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);

    await waitForText("How did you get your answer?");
    fireEvent.changeText(screen.getByPlaceholderText("Explain how you solved it…"), "I added two and two");
    await flush();
    fireEvent.press(screen.getByLabelText("Send"));
    await flush();

    // Echo + thinking bubble show while the request is still in flight.
    expect(screen.getByText("I added two and two")).toBeTruthy();
    expect(screen.getByText("Thinking…")).toBeTruthy();

    resolveTurn({
      ...STATE,
      overall_status: "in_progress",
      transcript: [
        ...STATE.transcript,
        { ordinal: 1, role: "student", content: "I added two and two", created_at: "x", is_variant_probe: false },
        { ordinal: 2, role: "agent", content: "Got it.", created_at: "x", is_variant_probe: false },
      ],
    });
    await flush();
    expect(screen.getByText("Got it.")).toBeTruthy();
  });

  it("on send failure shows an error and restores the draft", async () => {
    mockedApi.getIntegrityState.mockResolvedValue(STATE as never);
    mockedApi.postIntegrityTurn.mockRejectedValue(new Error("network"));
    render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);

    await waitForText("How did you get your answer?");
    fireEvent.changeText(screen.getByPlaceholderText("Explain how you solved it…"), "my reasoning");
    await flush();
    fireEvent.press(screen.getByLabelText("Send"));
    await flush();

    expect(screen.getByText("Couldn't send that — try again.")).toBeTruthy();
    // Draft is handed back so the words aren't lost.
    expect(screen.getByDisplayValue("my reasoning")).toBeTruthy();
  });

  it("shows a sub-threshold hint when the draft is too short to send", async () => {
    mockedApi.getIntegrityState.mockResolvedValue(STATE as never);
    render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);

    await waitForText("How did you get your answer?");
    fireEvent.changeText(screen.getByPlaceholderText("Explain how you solved it…"), "hi");
    await flush();

    expect(screen.getByText(/Add a little more — at least 5 characters\./)).toBeTruthy();
  });

  it("sends the truthful 'I'm stuck' message, bypassing the min-char gate", async () => {
    mockedApi.getIntegrityState.mockResolvedValue(STATE as never);
    mockedApi.postIntegrityTurn.mockResolvedValue({
      ...STATE,
      overall_status: "in_progress",
      transcript: [
        ...STATE.transcript,
        { ordinal: 1, role: "student", content: "I'm stuck — not sure how to explain this.", created_at: "x", is_variant_probe: false },
        { ordinal: 2, role: "agent", content: "That's okay — let's start small.", created_at: "x", is_variant_probe: false },
      ],
    } as never);
    render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);

    await waitForText("How did you get your answer?");
    // Tap the chip with the composer EMPTY — the truthful "I can't explain"
    // must send without hitting the 5-char minimum.
    fireEvent.press(screen.getByLabelText("I'm stuck — not sure how to explain this"));
    await flush();

    expect(mockedApi.postIntegrityTurn).toHaveBeenCalledWith(
      "sub-1",
      "I'm stuck — not sure how to explain this.",
      expect.any(Number),
      expect.objectContaining({ device_type: "mobile" }),
    );
    expect(await waitForText("That's okay — let's start small.")).toBeTruthy();
  });

  it("times out the 'Preparing…' wait and offers a retry instead of spinning forever", async () => {
    jest.useFakeTimers();
    try {
      // Pipeline never leaves "extracting" — the stall the safety net guards.
      mockedApi.getIntegrityState.mockResolvedValue({
        ...STATE,
        overall_status: "extracting",
        problems: [],
        transcript: [],
      } as never);
      render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);

      // Advance past the 90s give-up window; each re-poll resolves as we go.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(95_000);
      });

      expect(screen.getByText("This is taking longer than usual")).toBeTruthy();
      expect(screen.getByText("Try again")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
