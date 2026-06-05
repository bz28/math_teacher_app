"""Autonomous browser + API test harness.

Drives the real app end-to-end (boot → generate → browse → evaluate) to
verify AI-generated content (geometry figures first) is correct and
well-presented, while keeping API spend near zero via record/replay
cassettes. See plan: declarative-inventing-crown.

Nothing here runs in production. The only production touch-point is an
off-by-default cassette hook in api/core/llm_client.py, activated solely
by the HARNESS_LLM_MODE environment variable.
"""
