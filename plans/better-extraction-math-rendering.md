# Plan: Better Extraction + Math & Diagram Rendering

## Overview

Four changes that make the app dramatically better at handling real-world math/science problems:

1. Auto-extract full image (kill the box-drawing step)
2. KaTeX for math rendering (matrices, fractions, equations look real)
3. SVG diagrams from Claude (triangles, graphs, molecular structures rendered inline)
4. Original photo always visible when relevant

## Part 1: Auto-Extract Full Image

**New flow:** Upload photo → "Extracting..." → Results modal → Pick problems → Go

- Default: send full image to /image/extract, no box-drawing
- "Select areas manually" fallback link opens rectangle selector
- No backend changes needed — endpoint already accepts full images

## Part 2: KaTeX for Math Rendering

**Change extraction + decompose + step prompts** to return LaTeX:
- $...$ for inline math, $$...$$ for display math
- Matrices: \begin{pmatrix}...\end{pmatrix}
- Plain text stays plain

**New MathText component** (web + mobile):
- Splits text on $...$ and $$...$$ delimiters
- Math segments → KaTeX render
- SVG blocks → inline render (sanitized with DOMPurify)
- Text segments → normal text with bold markdown
- Fallback to raw text on KaTeX parse error

**Dependencies:**
- Web: katex + CSS
- Mobile: react-native-math-view

**Use MathText in:** problem display, step descriptions, chat messages, extraction modal

## Part 3: SVG Diagrams from Claude

**Update prompts:** "If a visual diagram would help, include an <svg> block"

Works well for: geometric shapes, coordinate planes, graphs, free body diagrams, basic molecular structures

Not attempted: complex organic chemistry, 3D, animations

**Security:** Sanitize SVG with DOMPurify — strip script tags, event handlers

## Part 4: Original Photo Always Visible

- Show at useful size (not tiny max-h-40 thumbnail)
- Expandable — click for full-size modal
- Collapsible "Original photo" section, expanded by default

## Commits (~8)

1. feat: add KaTeX to web + mobile dependencies
2. feat: create MathText component with LaTeX + SVG rendering
3. feat: update extraction prompt to return LaTeX
4. feat: update decompose + step prompts for LaTeX + SVG diagrams
5. feat: use MathText in learn session, practice, and history pages
6. feat: auto-extract full image as default flow
7. feat: add "select manually" fallback to rectangle selector
8. feat: make original photo expandable in session view

## Backwards compatibility

- Old sessions with plain text → MathText renders as-is (no $ = no parsing)
- No database migration needed
- KaTeX CSS ~30KB gzipped
