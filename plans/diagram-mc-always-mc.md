# Plan: Diagram MC + Always MC for Practice/Mock Test

## Overview

1. Practice and mock test are always MC (remove free response entirely)
2. Diagram-answer questions get SVG MC options
3. Remove check_answer LLM call — direct comparison for MC

## Part 1: Remove free response from practice + mock test

- Remove "Free response / Multiple choice" toggle from learn page input screen
- Both practice and mock test always show MC options (choices already generated via distractors)
- Learn mode: no quiz, just "I understand" (already done)

## Part 2: Add answer_type to decomposition

Update decompose prompt to output:
- "answer_type": "text" (default) or "diagram"
- If diagram: final_answer and distractors are SVG strings
- Claude decides based on problem (draw/sketch/show structure → diagram)

Add answer_type to Decomposition dataclass. Store in session JSON. Pass through API response.

## Part 3: Render diagram MC

When answer_type === "diagram":
- MC options are SVG images in 2x2 grid (single column on mobile)
- White background card, letter label (A/B/C/D)
- Same green/red feedback as text MC

When answer_type === "text" (default):
- MC options are text buttons (same as current)

## Part 4: Remove check_answer LLM call

Current: student picks MC → LLM call to check_answer → return correct/incorrect
New: student picks MC → string comparison against final_answer → instant

No mode uses free response anymore, so check_answer is dead code. Remove it.

## Edge cases

- Bad SVG distractors: fall back to answer_type "text"
- Old sessions: no answer_type → default "text"
- Mobile: 2x2 grid → single column on small screens

## Commits (~5)

1. refactor: remove free response toggle, enforce MC in practice + mock test
2. feat: add answer_type to decompose prompt and dataclass
3. feat: pass answer_type through session API
4. feat: render diagram MC as SVG cards
5. refactor: remove check_answer LLM call, use direct comparison
