import { exportFilename } from "./exportData";

describe("exportFilename", () => {
  it("builds a dated .json name from an ISO timestamp", () => {
    expect(exportFilename("2026-06-24T13:45:00.000Z")).toBe("veradic-data-2026-06-24.json");
  });
});
