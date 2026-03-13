"""Shared LLM utilities: markdown stripping, response parsing."""

import re


def strip_markdown_fencing(text: str) -> str:
    """Extract JSON from LLM response, handling code fences and preamble text.

    Handles cases where the LLM returns reasoning before the JSON block:
      Some explanation...
      ```json
      {"key": "value"}
      ```
    """
    text = text.strip()

    # Find a fenced code block anywhere in the response
    match = re.search(r"```(?:json)?\s*\n(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()

    # No fence found — return as-is for json.loads to attempt
    return text
