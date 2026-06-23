# Maestro E2E flows (Layer 3)

Drives the **real** app on an iOS simulator — the mobile equivalent of the
web browser agent. Renders the actual WebView math, exercises the real camera
permission flow, and captures screenshots you can inspect. Complements the
in-process RNTL component tests (Layer 2), which can't see real pixels or
native modules.

**Money cost: $0** — Maestro CLI, the iOS simulator, and local builds are all
free. The cost is time (a one-time native build) and the toolchain below.

## One-time setup

```bash
# 1. Toolchain
brew install temurin cocoapods           # Java (Maestro is JVM-based) + pods
curl -Ls https://get.maestro.mobile.dev | bash
export PATH="$PATH:$HOME/.maestro/bin"    # add to your shell profile

# 2. Build a dev .app for the simulator (~15-20 min first time; managed Expo
#    app has no ios/ dir, so this prebuilds + pod installs + xcodebuilds).
cd mobile
npx expo run:ios --configuration Release   # or open it once, then reuse
```

`expo run:ios` installs and launches the app on a booted simulator. After the
first build, subsequent runs are fast.

## Running the flows

The app talks to the backend, so bring the API up and seed accounts first:

```bash
# From repo root, with the dev stack running (API on :8000):
#   - a teacher account (for teacher-gate.yaml)
#   - a school student enrolled in a class with a published homework
#     (for school-student.yaml) — register with a class code, or seed via the
#     teacher web app.
# Put credentials in env the flows read (see each flow's `env:` block), e.g.:
export STUDENT_EMAIL=student@example.com STUDENT_PASSWORD=...
export TEACHER_EMAIL=teacher@example.com TEACHER_PASSWORD=...
```

```bash
export PATH="$PATH:$HOME/.maestro/bin"
maestro test mobile/maestro/flows/                       # run all flows
maestro test mobile/maestro/flows/school-student.yaml    # one flow
```

Screenshots land in `~/.maestro/tests/<run>/` and via each flow's
`takeScreenshot` steps. Maestro also auto-captures on failure.

## Notes
- Flows select by visible text (the screens are text-rich), so they don't
  depend on testIDs. Add `testID`s if a screen's copy gets ambiguous.
- These run locally; a macOS CI runner would cost money, so CI is out of scope
  here — run them on demand before shipping a mobile change.
