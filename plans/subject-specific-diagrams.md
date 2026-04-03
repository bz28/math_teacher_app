# Plan: Subject-Specific Diagram Rendering

## Overview

Replace Claude SVG with dedicated rendering libraries per subject:
- Chemistry: SMILES notation → smiles-drawer (textbook molecular structures)
- Math: function/coordinate JSON → mafs (interactive graphs)
- Physics: keep SVG (simple enough)

## Notation Claude outputs

Chemistry: `@@{"diagram_type": "smiles", "smiles": "c1ccc(N)cc1C(=O)NCCN(CC)CC", "label": "Procainamide"}@@`
Math: `@@{"diagram_type": "graph", "functions": [{"fn": "x^2-4", "color": "blue"}], "points": [{"x": 2, "y": 0}], "xRange": [-5,5], "yRange": [-5,10]}@@`
Physics: `<svg>...</svg>` (unchanged)

## Components

1. ChemDiagram — renders SMILES string via smiles-drawer
2. MathGraph — renders functions/points via mafs
3. MathText updated to parse @@{...}@@ diagram blocks

## Prompts updated

- Decompose: output structured notation per subject
- Practice generate: same for similar problems
- Distractor generation: wrong SMILES/functions for MC

## Dependencies

- smiles-drawer (~50KB)
- mafs + @mafs/core (~30KB)

## Commits (~6)

1. feat: add smiles-drawer + mafs dependencies
2. feat: create ChemDiagram component
3. feat: create MathGraph component
4. feat: update MathText to parse diagram JSON blocks
5. feat: update prompts for SMILES/graph notation
6. feat: render diagram MC with subject-specific libraries
