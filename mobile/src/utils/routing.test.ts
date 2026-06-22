import { decideLanding, isMfaChallenge } from "./routing";

describe("decideLanding", () => {
  it("routes teachers and admins to the web-app gate", () => {
    expect(decideLanding("teacher")).toBe("teacher-gate");
    expect(decideLanding("admin")).toBe("teacher-gate");
  });

  it("routes students to the study screen, school or not", () => {
    expect(decideLanding("student")).toBe("solve");
  });

  it("defaults to the study screen for unknown/missing roles", () => {
    expect(decideLanding(null)).toBe("solve");
    expect(decideLanding(undefined)).toBe("solve");
    expect(decideLanding("")).toBe("solve");
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
