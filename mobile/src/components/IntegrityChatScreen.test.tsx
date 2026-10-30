import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { TextInput } from "react-native";
import { IntegrityChatScreen } from "./IntegrityChatScreen";
import { flush, waitForText } from "../test-utils";
import * as api from "../services/api";

jest.mock("../services/api", () => ({
  getIntegrityState: jest.fn(),
  postIntegrityTurn: jest.fn(),
  MIN_INTEGRITY_MESSAGE_CHARS: 5,
}));
const mockedApi = api as jest.Mocked<typeof api>;

const STUCK_LABEL = "I'm stuck — not sure how to explain this";
const STUCK_MESSAGE = "I'm stuck — I'm not sure how to explain this.";
const NUDGE = "Give it a try in your own words — even a guess helps.";

const STATE = {
  submission_id: "sub-1",
  overall_status: "awaiting_student",
  disposition: null,
  stuck_tap_used: false,
  nudge_own_words: false,
  problems: [{ problem_id: "p1", hw_position: 3, status: "pending", question: "What is 2+2?" }],
  transcript: [
    { ordinal: 0, role: "agent", content: "How did you get your answer?", created_at: "x", is_variant_probe: false },
  ],
};

describe("IntegrityChatScreen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("a check closed unfinished says so instead of thanking the student", async () => {
    mockedApi.getIntegrityState.mockResolvedValue({
      ...STATE, overall_status: "complete", closed_unfinished: true,
    } as never);
    render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);
    expect(await waitForText(/closed because it wasn't finished/)).toBeTruthy();
    expect(screen.queryByText(/Thanks for explaining your work/)).toBeNull();
  });

  it("a finished check keeps the thank-you", async () => {
    mockedApi.getIntegrityState.mockResolvedValue({
      ...STATE, overall_status: "complete", disposition: "pass", closed_unfinished: false,
    } as never);
    render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);
    expect(await waitForText(/Thanks for explaining your work/)).toBeTruthy();
  });

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
      false,
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

  it("sends a stuck turn, bypassing the min-char gate, then disables the chip", async () => {
    mockedApi.getIntegrityState.mockResolvedValue(STATE as never);
    mockedApi.postIntegrityTurn.mockResolvedValue({
      ...STATE,
      overall_status: "in_progress",
      stuck_tap_used: true,
      transcript: [
        ...STATE.transcript,
        { ordinal: 1, role: "student", content: STUCK_MESSAGE, created_at: "x", is_variant_probe: false },
        { ordinal: 2, role: "agent", content: "That's okay — let's start small.", created_at: "x", is_variant_probe: false },
      ],
    } as never);
    render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);

    await waitForText("How did you get your answer?");
    // Tap the chip with the composer EMPTY — the truthful "I can't explain"
    // must send without hitting the 5-char minimum.
    fireEvent.press(screen.getByLabelText(STUCK_LABEL));
    await flush();

    expect(mockedApi.postIntegrityTurn).toHaveBeenCalledWith(
      "sub-1",
      "",
      expect.any(Number),
      expect.objectContaining({ device_type: "mobile" }),
      true,
    );
    expect(await waitForText("That's okay — let's start small.")).toBeTruthy();
    // Spent: the chip disables with a nudge, and a second tap sends nothing.
    expect(screen.getByLabelText(STUCK_LABEL)).toBeDisabled();
    expect(screen.getByText(NUDGE)).toBeTruthy();
    fireEvent.press(screen.getByLabelText(STUCK_LABEL));
    await flush();
    expect(mockedApi.postIntegrityTurn).toHaveBeenCalledTimes(1);
  });

  it("after the stuck tap, a short typed answer still sends", async () => {
    mockedApi.getIntegrityState.mockResolvedValue({ ...STATE, stuck_tap_used: true } as never);
    mockedApi.postIntegrityTurn.mockResolvedValue({ ...STATE, stuck_tap_used: true } as never);
    render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);

    await waitForText("How did you get your answer?");
    // Resumed with the tap spent: chip disabled, one nudge shown.
    expect(screen.getByLabelText(STUCK_LABEL)).toBeDisabled();
    expect(screen.getAllByText(NUDGE)).toHaveLength(1);

    fireEvent.changeText(screen.getByPlaceholderText("Explain how you solved it…"), "y=2x+3");
    await flush();
    fireEvent.press(screen.getByLabelText("Send"));
    await flush();
    expect(mockedApi.postIntegrityTurn).toHaveBeenCalledWith(
      "sub-1",
      "y=2x+3",
      expect.any(Number),
      expect.objectContaining({ device_type: "mobile" }),
      false,
    );
  });

  it("opens the own-words sheet once when a reply turns the nudge on", async () => {
    const focusSpy = jest.spyOn(TextInput.prototype, "focus").mockImplementation(() => {});
    const IN_PROGRESS = { ...STATE, overall_status: "in_progress" };
    mockedApi.getIntegrityState.mockResolvedValue(STATE as never);
    mockedApi.postIntegrityTurn.mockResolvedValue({ ...IN_PROGRESS, nudge_own_words: true } as never);
    render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);
    await waitForText("How did you get your answer?");
    expect(screen.queryByText("Answer in your own words")).toBeNull();

    fireEvent.changeText(screen.getByPlaceholderText("Explain how you solved it…"), "dunno really");
    await flush();
    fireEvent.press(screen.getByLabelText("Send"));
    await flush();
    expect(screen.getByText("Answer in your own words")).toBeTruthy();

    // Dismissed, focus goes back to the composer and the sheet stays closed
    // while the same streak continues.
    fireEvent.press(screen.getByText("Got it"));
    await flush();
    expect(screen.queryByText("Answer in your own words")).toBeNull();
    expect(focusSpy).toHaveBeenCalled();
    fireEvent.changeText(screen.getByPlaceholderText("Explain how you solved it…"), "no idea man");
    await flush();
    fireEvent.press(screen.getByLabelText("Send"));
    await flush();
    expect(screen.queryByText("Answer in your own words")).toBeNull();
  });

  it("never opens the sheet on resume", async () => {
    mockedApi.getIntegrityState.mockResolvedValue(
      { ...STATE, overall_status: "in_progress", nudge_own_words: true } as never,
    );
    render(<IntegrityChatScreen submissionId="sub-1" onExit={jest.fn()} />);
    await waitForText("How did you get your answer?");
    expect(screen.queryByText("Answer in your own words")).toBeNull();
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
