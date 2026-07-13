import { EntitlementError, getSchoolGrades, joinSection } from "./api";

// api.ts reads SecureStore lazily inside auth helpers; stub it so importing
// and exercising the fetch path doesn't touch the native keystore.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

/** Minimal Response stand-in — the fetch wrapper only reads status/ok/json/clone. */
function fakeResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    clone: () => ({ json: async () => body }),
  };
}

const ENTITLEMENT_BODY = (isLimit: boolean) => ({
  error: "entitlement_required",
  entitlement: "unlimited_practice",
  message: "You've hit your daily limit",
  is_limit: isLimit,
});

describe("403 entitlement_required conversion", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  it("converts a limit-hit 403 on a GET into an EntitlementError with isLimit=true", async () => {
    global.fetch = jest.fn(async () => fakeResponse(403, ENTITLEMENT_BODY(true))) as never;
    await expect(getSchoolGrades()).rejects.toMatchObject({
      name: "EntitlementError",
      entitlement: "unlimited_practice",
      isLimit: true,
    });
  });

  it("defaults isLimit=false for a Pro-only 403 (is_limit false)", async () => {
    global.fetch = jest.fn(async () => fakeResponse(403, ENTITLEMENT_BODY(false))) as never;
    const err = await getSchoolGrades().catch((e) => e);
    expect(err).toBeInstanceOf(EntitlementError);
    expect((err as EntitlementError).isLimit).toBe(false);
  });

  it("also converts on a POST verb (shared path), carrying isLimit", async () => {
    global.fetch = jest.fn(async () => fakeResponse(403, ENTITLEMENT_BODY(true))) as never;
    const err = await joinSection("ABC123").catch((e) => e);
    expect(err).toBeInstanceOf(EntitlementError);
    expect((err as EntitlementError).isLimit).toBe(true);
  });

  it("leaves a non-entitlement 403 as a generic Error (caller can still read the body)", async () => {
    global.fetch = jest.fn(async () => fakeResponse(403, { detail: "forbidden" })) as never;
    const err = await getSchoolGrades().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(EntitlementError);
    expect((err as Error).message).toBe("forbidden");
  });
});
