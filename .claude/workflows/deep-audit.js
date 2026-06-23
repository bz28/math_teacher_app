export const meta = {
  name: 'deep-audit',
  description: 'Parallel multi-agent codebase audit — cleanliness-weighted review, adversarial 2-skeptic verify, P0–P3 synthesis',
  phases: [
    { title: 'Review', detail: 'one agent per shard, read end-to-end' },
    { title: 'Verify', detail: 'N independent skeptics per finding, strict' },
    { title: 'Synthesize', detail: 'dedupe across shards, tier P0–P3' },
  ],
}

// args = { shards: [{key,label,kind:'vertical'|'thematic',paths:[...],focus?}], verifySkeptics?, emphasis? }
let cfg = args
if (typeof cfg === 'string') {
  try { cfg = JSON.parse(cfg) } catch (e) { cfg = {} }
}
cfg = cfg || {}

const shards = cfg.shards || []
const SKEPTICS = cfg.verifySkeptics || 2
const EMPHASIS = cfg.emphasis || 'code quality and cleanliness'

if (!shards.length) {
  log('No shards provided in args — nothing to audit.')
  return { tiers: { P0: [], P1: [], P2: [], P3: [] }, summary: 'No shards provided.', stats: { shards: 0, confirmed: 0 } }
}

const FINDING_ITEM = {
  type: 'object',
  required: ['file', 'severity', 'category', 'title', 'detail'],
  properties: {
    file: { type: 'string', description: 'repo-relative path' },
    line: { type: 'string', description: 'line number or range, if known' },
    severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
    category: { type: 'string', description: 'e.g. dead-code, DRY, inconsistent-pattern, naming, type-safety, correctness, security, perf' },
    title: { type: 'string' },
    detail: { type: 'string', description: 'what is wrong and why it matters' },
    evidence: { type: 'string', description: 'the exact code / call sites that prove it' },
    suggested_fix: { type: 'string', description: 'the reliable fix — no bandages, no hardcoding' },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: { findings: { type: 'array', items: FINDING_ITEM } },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding does NOT hold up under scrutiny' },
    reasoning: { type: 'string' },
  },
}

const SYNTH_SCHEMA = {
  type: 'object',
  required: ['tiers', 'summary'],
  properties: {
    summary: { type: 'string', description: 'one-paragraph state-of-the-codebase from the confirmed findings' },
    tiers: {
      type: 'object',
      required: ['P0', 'P1', 'P2', 'P3'],
      properties: {
        P0: { type: 'array', items: FINDING_ITEM },
        P1: { type: 'array', items: FINDING_ITEM },
        P2: { type: 'array', items: FINDING_ITEM },
        P3: { type: 'array', items: FINDING_ITEM },
      },
    },
  },
}

const CHECKLIST = `Look for ALL of these, but lead with the first group (emphasis: ${EMPHASIS}):
- Cleanliness: dead code, unused imports/exports, unreachable branches, commented-out code, forgotten debug logs, stale TODOs
- DRY: logic repeated 3+ times that should be shared (do NOT flag a 2nd occurrence or a single-use "could extract" — that is noise)
- Consistency: the same concern handled differently across peers (error handling, validation, response shaping)
- Naming, premature abstraction, oversized modules/functions
- Type-safety gaps (any, unchecked casts, missing null handling at boundaries)
- Also flag any clear correctness / security / performance bug you trip over — do not suppress a real bug because the emphasis is cleanliness.`

function reviewPrompt(s) {
  const scope = s.paths.join(', ')
  if (s.kind === 'thematic') {
    return `You are a world-class engineer auditing a cross-cutting concern that no single-directory reviewer can see.

CONCERN: ${s.label}
${s.focus}

Read the actual code across these paths: ${scope}. Trace the seams — do not guess from file names.

${CHECKLIST}

Two-pass rule: after your first sweep, re-verify every finding by reading the actual code and tracing call sites. Return ONLY findings you re-confirmed. For each, give exact file path, line, the evidence that proves it, and the reliable fix. Your output is data for a verification stage, not prose — be precise and concrete.`
  }
  return `You are a world-class engineer doing a deep cleanliness-first review of one slice of the codebase.

SCOPE (read these end-to-end): ${scope}

${CHECKLIST}

Read the files in scope completely — do not skim, do not guess from names. When a finding depends on a caller/peer outside your scope, note it but only assert what you can verify.

Two-pass rule: after your first sweep, re-verify every finding by reading the actual code and tracing call sites. Discard anything you cannot confirm. Return ONLY survivors, each with exact file path, line, the evidence, and the reliable fix. Your output is data for a verification stage, not prose.`
}

function verifyPrompt(f, i) {
  return `You are an independent skeptic (reviewer #${i + 1}). Your job is to REFUTE the finding below by reading the actual code — not to agree with it.

FINDING
  file: ${f.file}${f.line ? ':' + f.line : ''}
  category: ${f.category}
  severity: ${f.severity}
  title: ${f.title}
  detail: ${f.detail}
  evidence claimed: ${f.evidence || '(none given)'}

Open the cited file and the surrounding code. Try to prove the finding WRONG: maybe the "dead" code is reachable, the "duplication" is actually used once, the "bug" is prevented by an upstream guarantee, the line/claim doesn't match reality, or it's a deliberate pattern used consistently elsewhere.

Set refuted=true if the finding does not hold up OR you cannot independently confirm it from the code. Only set refuted=false when you have read the code and the finding is unambiguously real. Default to refuted=true when uncertain.`
}

function synthPrompt(findings) {
  return `You are synthesizing the results of a parallel codebase audit. Below are findings that each survived independent adversarial verification.

${JSON.stringify(findings, null, 2)}

Do two things:
1. DEDUPE — the same issue often surfaces from multiple shards (a vertical reviewer and a thematic one). Merge findings that share a root cause or the same file:line; when merging, list every affected file in the detail.
2. TIER by blast radius into P0–P3:
   - P0: data loss, security, auth bypass, money
   - P1: correctness bugs that will ship to users
   - P2: UX problems users notice but won't break things
   - P3: code quality, naming, DRY, dead code, comments
   (Re-tier if a finding's self-assigned severity is wrong.)

Return the deduped, tiered findings plus a one-paragraph summary of the codebase's overall cleanliness state. Keep each finding's exact file/line and suggested_fix intact.`
}

log(`Auditing ${shards.length} shards (${shards.filter(s => s.kind === 'thematic').length} thematic); ${SKEPTICS} skeptics/finding, strict.`)

const perShard = await pipeline(
  shards,
  s => agent(reviewPrompt(s), { label: `review:${s.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  (review, s) =>
    parallel(((review && review.findings) || []).map(f => () =>
      parallel(Array.from({ length: SKEPTICS }, (_, i) => () =>
        agent(verifyPrompt(f, i), { label: `verify:${s.key}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      )).then(votes => {
        const answered = votes.filter(Boolean)
        // Strict: survives only if EVERY skeptic answered and NONE refuted it.
        const survives = answered.length === SKEPTICS && answered.every(v => v.refuted === false)
        return survives ? { ...f, shard: s.key } : null
      })
    ))
)

const confirmed = perShard.flat().filter(Boolean)
log(`${confirmed.length} findings survived adversarial verification.`)

if (!confirmed.length) {
  return {
    tiers: { P0: [], P1: [], P2: [], P3: [] },
    summary: 'No findings survived adversarial verification.',
    stats: { shards: shards.length, confirmed: 0 },
  }
}

phase('Synthesize')
const synth = await agent(synthPrompt(confirmed), { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA })
return { ...synth, stats: { shards: shards.length, confirmed: confirmed.length } }
