import { decideLanding, isMfaChallenge } from "./routing";

describe("decideLanding", () => {
  it("routes teachers and admins to the web-app gate", () => {
    expect(decideLanding("teacher")).toBe("teacher-gate");
    expect(decideLanding("admin")).toBe("teacher-gate");
  });

  it("routes every student, in a class or not, to the classroom home", () => {
    expect(decideLanding("student")).toBe("school-home");
  });

  it("never lands anyone on the hidden personal study screens", () => {
    for (const role of [null, undefined, "", "student"]) {
      expect(decideLanding(role)).toBe("school-home");
    }
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
