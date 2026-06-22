import { decideLanding, isMfaChallenge } from "./routing";

describe("decideLanding", () => {
  it("routes teachers and admins to the web-app gate (regardless of school)", () => {
    expect(decideLanding("teacher", null)).toBe("teacher-gate");
    expect(decideLanding("admin", "school-1")).toBe("teacher-gate");
  });

  it("routes a student with a school to the classroom home", () => {
    expect(decideLanding("student", "school-1")).toBe("school-home");
  });

  it("routes a personal student (no school) to the study screen", () => {
    expect(decideLanding("student", null)).toBe("solve");
    expect(decideLanding("student", "")).toBe("solve");
  });

  it("defaults to the study screen for unknown/missing roles", () => {
    expect(decideLanding(null, null)).toBe("solve");
    expect(decideLanding(undefined, undefined)).toBe("solve");
    expect(decideLanding("", null)).toBe("solve");
  });
});

describe("isMfaChallenge", () => {
  it("is true when no access token was issued (MFA pending)", () => {
    expect(isMfaChallenge({ mfa_pending_token: "x" } as { access_token?: string })).toBe(true);
    expect(isMfaChallenge({})).toBe(true);
  });

  it("is false for a normal token grant", () => {
    expect(isMfaChallenge({ access_token: "a" })).toBe(false);
  });
});
