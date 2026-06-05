"""Autonomous improver — the half that *proposes* work, not just verifies it.

Where the harness asks "does this AI-generated figure render correctly", the
improver drives the same real app and asks "what could be better on this whole
page" — across web, admin, and the Expo-web mobile build. It reuses the
harness wholesale (cached Chromium + token injection in `browser.py`, the
isolated `seed_world()`, the cassette $0 replay layer, the vision judge in
`eval.py`, the cost tracker in `runner.py`) and adds: a surface catalog, a
scanner, objective detectors, a UX judge, ideation/dedup/ranking, a budget
governor, and an approval -> orchestrated-execution loop.

See tests/harness/improver/README.md for the architecture.
"""
