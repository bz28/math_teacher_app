export const meta = {
  name: 'review-loop',
  description: 'One round of PR review — cold reviewer over the branch diff, then N independent skeptics per finding; returns confirmed + refuted',
  phases: [
    { title: 'Review', detail: 'cold reviewer reads the diff + every touched file end-to-end' },
    { title: 'Verify', detail: 'N independent skeptics per finding, strict — default refute' },
  ],
}

// args = {
//   base: 'origin/main',            // what the branch is compared against (fetch first!)
//   head: 'HEAD',                   // the branch tip under review
//   round: 1,                       // 1-based; round >= 2 re-checks priorConfirmed
//   priorConfirmed: [...],          // findings confirmed in the previous round (now supposedly fixed)
//   sinceLastRound: '<sha>',        // round >= 2: the commit the previous round reviewed, so the reviewer
//                                   //   can `git diff <sha>..head` to see exactly what the fixes changed
//   skeptics: 2,
//   intent: 'what the PR is trying to do (one paragraph, from the session)',
//   verifyOnly: [...],              // skip the reviewer; run the skeptics on these findings (the
//                                   //   in-session review's own findings, so they earn "confirmed" the same way)
// }
let cfg = args
if (typeof cfg === 'string') {
  try { cfg = JSON.parse(cfg) } catch (e) { cfg = {} }
}
cfg = cfg || {}

const BASE = cfg.base || 'origin/main'
const HEAD = cfg.head || 'HEAD'
const ROUND = cfg.round || 1
const PRIOR = cfg.priorConfirmed || []
const SINCE = cfg.sinceLastRound || null
const SKEPTICS = cfg.skeptics || 2
const INTENT = cfg.intent || '(not provided)'
const VERIFY_ONLY = cfg.verifyOnly || null

const FINDING_ITEM = {
  type: 'object',
  required: ['file', 'severity', 'category', 'title', 'detail', 'evidence', 'pin'],
  properties: {
    file: { type: 'string', description: 'repo-relative path' },
    line: { type: 'string', description: 'line number or range' },
    severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
    category: { type: 'string', description: 'correctness, edge-case, security, perf, data-loss, regression-in-caller, mobile-ux, DRY, consistency' },
    title: { type: 'string' },
    detail: { type: 'string', description: 'what is wrong and what a user would see' },
    evidence: { type: 'string', description: 'the exact code / call sites that prove it — quote them' },
    suggested_fix: { type: 'string', description: 'the reliable fix — no bandages, no hardcoding' },
    pin: { type: 'string', description: 'the test that must FAIL if this fix is reverted (file + what it asserts). "render-check" for UI-only.' },
    prior_ref: { type: 'string', description: 'round >= 2 only: the prior finding title this relates to (unfixed / shallow-fixed / regression from its fix)' },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings', 'prior_status'],
  properties: {
    findings: { type: 'array', items: FINDING_ITEM },
    prior_status: {
      type: 'array',
      description: 'round >= 2: one entry per prior confirmed finding',
      items: {
        type: 'object',
        required: ['title', 'status', 'reasoning'],
        properties: {
          title: { type: 'string' },
          status: { type: 'string', enum: ['fixed', 'shallow', 'unfixed'] },
          reasoning: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding does NOT hold up under scrutiny, or you could not independently confirm it' },
    reasoning: { type: 'string', description: 'what you read and why it does / does not hold' },
  },
}

const CHECKLIST = `Check for:
- Correctness and logic errors
- Edge cases and boundary conditions (count=0, empty, boundaries, concurrency, retries)
- Regressions in callers/peers NOT in the diff — a focused diff review misses these
- Security (OWASP top 10, auth, injection, data exposure)
- Data loss or silent failure (swallowed exceptions, aborted transactions, no-op writes)
- Performance (N+1, unbounded fan-out, shared-pool exhaustion)
- Mobile UX issues
- Consistency with existing code patterns; DRY violations and unnecessary complexity

Tier by blast radius: P0 data loss / security / auth / money · P1 correctness bugs that ship · P2 UX users notice · P3 quality / naming / DRY.

Avoid by name:
- Style nits when correctness issues are unaddressed
- "Consider extracting X" when X is used once
- "What about edge case Y?" without checking whether Y can actually happen given upstream guarantees
- Re-stating what the code does without naming a defect
- Suggesting tests for code already covered by an existing test`

function reviewPrompt() {
  const priorBlock = ROUND >= 2 ? `
THIS IS ROUND ${ROUND}. The previous round confirmed these findings and the author says they are fixed:
${JSON.stringify(PRIOR, null, 2)}

Two extra obligations this round:
1. For EACH prior finding, verify it is actually fixed — not shallowly. Read the fix. A guard copied from a sibling's *shape* without its *substance*, an exception check on the wrong type, a fix that covers the reported instance but not the pattern — those are "shallow". Report every prior finding in prior_status.
2. Fixes introduce bugs. Run \`git diff ${SINCE}..${HEAD}\` to see exactly what changed since the last round and read THAT code hardest. Two fixes that are each fine can combine into a new defect.
` : `
THIS IS ROUND 1. prior_status should be an empty array.
`
  return `You are a world-class engineer doing a cold, independent review of a branch. You have no context on the conversation that produced it — that is the point. Ground every claim in code you read.

WHAT THE BRANCH IS TRYING TO DO (author's intent, treat as a claim to check, not a fact):
${INTENT}

HOW TO READ IT:
- \`git diff ${BASE}...${HEAD}\` is the change. \`git diff --stat ${BASE}...${HEAD}\` lists touched files.
- After the diff, read EACH touched file end-to-end (for files > ~500 lines: the touched regions plus their direct callers/peers). Then grep for every caller of anything whose signature, return shape, or behavior changed, and check those callers still work.
- Do not guess from names. Open the file.
${priorBlock}
${CHECKLIST}

Two-pass rule: after your first sweep, re-verify every finding by re-reading the code and tracing call sites. Discard anything you cannot confirm. Return ONLY survivors. For each: exact file path + line, the code that proves it (quoted), the reliable fix, and the \`pin\` — the test that must fail if the fix is reverted. Your output is data for an adversarial verification stage, not prose — be precise and concrete. Surface everything; do not narrow quietly.`
}

function verifyPrompt(f, i) {
  return `You are an independent skeptic (reviewer #${i + 1}). Your job is to REFUTE the finding below by reading the actual code — not to agree with it.

BRANCH: compare \`${BASE}...${HEAD}\` (\`git diff ${BASE}...${HEAD} -- ${f.file}\` shows what changed in the cited file).

FINDING
  file: ${f.file}${f.line ? ':' + f.line : ''}
  severity: ${f.severity}
  category: ${f.category}
  title: ${f.title}
  detail: ${f.detail}
  evidence claimed: ${f.evidence || '(none given)'}

Open the cited file and the surrounding code, and the callers if the claim is about them. Try to prove the finding WRONG: the "bug" is prevented by an upstream guarantee (find it and cite it), the cited line doesn't say what the reviewer claims, the code path is unreachable, the behavior is a deliberate pattern used consistently elsewhere, the "edge case" cannot occur given the data model, or the claim is about code that is unchanged and identical on ${BASE} (a pre-existing issue is still worth knowing — but say so explicitly in reasoning).

Set refuted=true if the finding does not hold up OR you cannot independently confirm it from the code. Only set refuted=false when you have read the code and the finding is unambiguously real. Default to refuted=true when uncertain. In reasoning, name the file:line you read that decided it.`
}

let findings, priorStatus
if (VERIFY_ONLY) {
  log(`Round ${ROUND} (verify-only): ${VERIFY_ONLY.length} in-session finding(s) → ${SKEPTICS} skeptics each, strict.`)
  findings = VERIFY_ONLY
  priorStatus = []
} else {
  log(`Round ${ROUND}: reviewing ${BASE}...${HEAD}; ${SKEPTICS} skeptics/finding, strict.${ROUND >= 2 ? ` Re-checking ${PRIOR.length} prior finding(s).` : ''}`)
  phase('Review')
  const review = await agent(reviewPrompt(), { label: `review:round${ROUND}`, phase: 'Review', schema: FINDINGS_SCHEMA })
  findings = (review && review.findings) || []
  priorStatus = (review && review.prior_status) || []
  log(`Reviewer returned ${findings.length} finding(s).`)
}

if (!findings.length) {
  return { round: ROUND, confirmed: [], refuted: [], priorStatus, stats: { found: 0, confirmed: 0, refuted: 0 } }
}

phase('Verify')
const judged = await parallel(findings.map(f => () =>
  parallel(Array.from({ length: SKEPTICS }, (_, i) => () =>
    agent(verifyPrompt(f, i), { label: `verify:${f.file.split('/').pop()}`, phase: 'Verify', schema: VERDICT_SCHEMA })
  )).then(votes => {
    const answered = votes.filter(Boolean)
    // Strict: survives only if EVERY skeptic answered and NONE refuted it.
    const survives = answered.length === SKEPTICS && answered.every(v => v.refuted === false)
    return { finding: f, survives, votes: answered.map(v => v.reasoning), unanswered: SKEPTICS - answered.length }
  })
))

const confirmed = judged.filter(j => j && j.survives).map(j => ({ ...j.finding, skeptics: j.votes }))
const refuted = judged.filter(j => j && !j.survives).map(j => ({
  ...j.finding,
  skeptics: j.votes,
  reason: j.unanswered ? `${j.unanswered} skeptic(s) did not answer — dropped (strict)` : 'refuted by at least one skeptic',
}))
log(`Round ${ROUND}: ${confirmed.length} confirmed, ${refuted.length} refuted.`)

return {
  round: ROUND,
  confirmed,
  refuted,
  priorStatus,
  stats: { found: findings.length, confirmed: confirmed.length, refuted: refuted.length },
}
