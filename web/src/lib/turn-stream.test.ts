// Unit tests for the streamed integrity turn client (streamIntegrityTurn).
// Runs on plain Node (>=22.6) via native TS type-stripping.
//
// The promise under test: streaming changes when the agent's words show,
// not what the call resolves or rejects with. `done` resolves with the
// server's state; `error` rejects with the same ApiError status/message
// the unstreamed /turn would have; a stream that breaks off rejects as a
// network failure — and deltas split across chunks arrive intact.
import assert from "node:assert/strict";
import { test } from "node:test";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { addEventListener: unknown }).addEventListener =
  () => {};

/** Chunks the mock server sends, split wherever a test wants; a number
 *  is a pause of that many ms before the next chunk. */
let chunks: (string | number)[] = [];
let lastUrl = "";

(globalThis as unknown as { fetch: unknown }).fetch = async (
  url: string,
): Promise<Response> => {
  lastUrl = url;
  const enc = new TextEncoder();
  const script = [...chunks];
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const next = script.shift();
        if (next === undefined) return controller.close();
        if (typeof next === "number") {
          await new Promise((r) => setTimeout(r, next));
          continue;
        }
        return controller.enqueue(enc.encode(next));
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

const { schoolStudent, parseSseEvents, ApiError, NetworkError } = await import(
  "./api.ts"
);

const STATE = { overall_status: "in_progress", transcript: [], problems: [] };
const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

async function run(idleTimeout?: number) {
  const seen: [number, string][] = [];
  const result = await schoolStudent.streamIntegrityTurn(
    "sub-1",
    { message: "I split it into two parts." },
    (bubble, text) => seen.push([bubble, text]),
    idleTimeout,
  );
  return { seen, result };
}

test("parseSseEvents keeps a partial event for the next chunk", () => {
  const { events, rest } = parseSseEvents(
    ": open\n\nevent: delta\ndata: {\"a\":1}\n\nevent: do",
  );
  assert.deepEqual(events, [{ event: "delta", data: '{"a":1}' }]);
  assert.equal(rest, "event: do");
});

test("deltas stream in order and done resolves with the server state", async () => {
  const all =
    ": open\n\n" +
    sse("delta", { bubble: 0, text: "Why did you " }) +
    sse("delta", { bubble: 0, text: "divide by 2?" }) +
    sse("delta", { bubble: 2, text: "Thanks!" }) +
    sse("done", STATE);
  // Split mid-event and mid-JSON.
  chunks = [all.slice(0, 17), all.slice(17, 60), all.slice(60)];
  const { seen, result } = await run();
  assert.ok(lastUrl.endsWith("/school/student/integrity/submissions/sub-1/turn/stream"));
  assert.deepEqual(seen, [
    [0, "Why did you "],
    [0, "divide by 2?"],
    [2, "Thanks!"],
  ]);
  assert.deepEqual(result, STATE);
});

test("an error event rejects like the unstreamed call", async () => {
  chunks = [
    sse("delta", { bubble: 0, text: "Half" }),
    sse("error", { status: 400, detail: "You've already used that." }),
  ];
  await assert.rejects(run(), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 400);
    assert.equal(e.message, "You've already used that.");
    return true;
  });
});

test("a stream that ends without a result is a network failure", async () => {
  chunks = [sse("delta", { bubble: 0, text: "Half a tho" })];
  await assert.rejects(run(), (e: unknown) => e instanceof NetworkError);
});

test("heartbeats keep a long turn alive past the inactivity timeout", async () => {
  // 4 x 40ms of pings = 160ms total, never 60ms of silence.
  chunks = [": open\n\n"];
  for (let i = 0; i < 4; i++) chunks.push(40, ": ping\n\n");
  chunks.push(sse("delta", { bubble: 1, text: "Why?" }), 40, sse("done", STATE));
  const { seen, result } = await run(60);
  assert.deepEqual(seen, [[1, "Why?"]]);
  assert.deepEqual(result, STATE);
});

test("a stream silent past the inactivity timeout fails as a timeout", async () => {
  chunks = [": open\n\n", sse("delta", { bubble: 0, text: "Half" }), 300];
  await assert.rejects(run(60), (e: unknown) => {
    assert.ok(e instanceof NetworkError);
    assert.equal(e.cause, "timeout");
    return true;
  });
});
