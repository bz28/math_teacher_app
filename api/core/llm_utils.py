"""Shared LLM utilities: markdown stripping, response parsing."""


def strip_markdown_fencing(text: str) -> str:
    """Strip markdown code fencing from LLM response text."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    return text
