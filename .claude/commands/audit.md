You are a world-class senior engineer running a deep, **parallel** codebase audit. `/audit` is no longer a single in-context sweep — it shards the codebase across many agents, verifies each finding adversarially, and synthesizes. Emphasis: **code quality and cleanliness**. The orchestration lives in the `deep-audit` workflow; your job is to compute the live shard plan, launch it, and drive the fix loop.

## 1. Compute the shard plan from the LIVE tree (never hardcode shards)

Shards are derived every run so they self-adjust as the codebase grows. Measure first:

```
for d in api dashboard mobile web tests scripts; do
  find "$d" -type f \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) \
    -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/dist/*' -not -path '*/build/*' 2>/dev/null \
    | xargs wc -l 2>/dev/null | tail -1 | awk -v d="$d" '{print d": "$1" lines"}'
done
```

Also list the immediate subdirs of any large top-level dir (`ls api web/src mobile/src dashboard/src`) so you can split it.

**Packing rules (budget per shard ≈ ≤15k lines or ≤70 files, so one agent can read it end-to-end):**
- A top-level dir under budget → one shard.
- A dir over budget → split by its subdirs; merge sibling subdirs under ~3k lines into one shard.
- A dir under ~3k lines → fine to merge with a sibling.
- `tests` gets its own shard (lower priority — dead/duplicated test helpers, not product bugs).

These produce the **vertical** shards. Then always append two **constant thematic** shards — they audit seams *between* shards, which no per-dir agent can see:
- `cross-layer-contract` — API request/response shapes (`api/schemas`, `api/routes`) vs. what consumers assume (`web/src/services`, `web/src/lib`, `mobile/src/services`); inconsistent error handling across routes.
- `cross-dir-duplication` — logic copy-pasted across `api`/`web`/`mobile`/`dashboard` that should be shared.

Each shard is an object: `{ key, label, kind: "vertical"|"thematic", paths: [...], focus? }` (`focus` is a one-line description for thematic shards).

**Print the computed shard plan to the user** (one line per shard: key → paths) before launching, so nothing falls through a crack and they can see the coverage.

## 2. Launch the workflow

Invoke the `deep-audit` workflow by **scriptPath** (named-workflow lookup does not find `.claude/workflows/`), passing the shards as args:

```
Workflow({ scriptPath: ".claude/workflows/deep-audit.js", args: { shards: <the array>, verifySkeptics: 2, emphasis: "code quality and cleanliness" } })
```

It runs Review (one agent/shard) → Verify (2 independent skeptics per finding, strict — survives only if neither refutes) → Synthesize (dedupe across shards, tier P0–P3). It returns `{ tiers: {P0,P1,P2,P3}, summary, stats }`. Everything it returns is already **confirmed** (survived adversarial verification) — there is no `suspected` bucket to relay.

## 3. Present and drive fixes

- Show the `summary`, then the findings grouped by tier (P0 → P3), each with exact file:line, why it matters, and the suggested reliable fix.
- Tiers (blast radius): **P0** data loss / security / auth / money · **P1** correctness bugs that ship · **P2** UX users notice · **P3** quality / naming / DRY / dead code. Expect P3 to be the fat tier given the cleanliness emphasis — that's intended.
- Use `AskUserQuestion` to ask which tier(s) to fix in this pass. Don't lump P3 nits with P0/P1.
- **Scope rule:** err toward the bigger fix. If 10 findings share a root cause, propose fixing all 10 — don't quietly narrow.
- **Wait for approval** before applying any fix unless the user said "go". Apply reliable fixes only — no bandages, no hardcoding.

## 4. Verify and summarize

After approved fixes, run the relevant lint and type-checks for the areas you touched (ruff + mypy for `api`; the package lint + `tsc` for `web`/`mobile`/`dashboard`) and confirm nothing broke. Then summarize: what was found, what was fixed, what was deferred, and how it was verified.

**Isolation:** audits + their fixes touch many files. If the user hasn't set up an isolated worktree and intends to apply fixes, suggest one before starting.
