# Golden Set — Generated Problems (raw, as generated)


## Accelerated Geometry — Unit: Circle Theorems

_Counts: {'pending': 1, 'approved': 4, 'rejected': 0, 'archived': 0}_


### Q1 · medium · frq · figure ✔ · status=approved

**Question:** From external point $P$, a tangent touches circle $O$ at point $T$, and a secant passes through the circle intersecting it at points $A$ and $B$ (with $A$ between $P$ and $B$). The far arc $\overset{\frown}{TB}$ (not containing $A$) measures $(8x + 6)°$, and the near arc $\overset{\frown}{TA}$ (between the tangent and secant on the near side) measures $(2x + 10)°$. The angle formed at $P$ is $\angle TPB = 44°$. Using the secant–tangent angle theorem, set up and solve an equation to find the degree measure of arc $\overset{\frown}{TB}$.

**Final answer:** $\overset{\frown}{TB} = \dfrac{386}{3}° \approx 128.\overline{6}°$

**Solution steps:**
  1. {'title': 'Understand the Setup', 'description': 'We have an external point $P$, a tangent to circle $O$ touching at $T$, and a secant cutting the circle at $A$ (near) then $B$ (far).\n\nThe **Secant–Tangent Angle Theorem** says: an angle formed outside a circle by a tangent and a secant equals **half the positive difference** of its two intercepted arcs:\n$$\\angle P = \\frac{1}{2}\\bigl(\\overset{\\frown}{TB}_{\\text{far}} - \\overset{\\frown}{TA}_{\\text{near}}\\bigr)$$\nThe key insight: always subtract the **smaller (near) arc** from the **larger (far) arc**, then halve. This is the only formula needed here.'}
  2. {'title': 'Plug Into the Formula', 'description': 'Substitute the known values — $\\angle P = 44°$, far arc $\\overset{\\frown}{TB} = (8x+6)°$, near arc $\\overset{\\frown}{TA} = (2x+10)°$ — directly into the theorem:\n$$44 = \\frac{1}{2}\\bigl[(8x+6)-(2x+10)\\bigr]$$'}
  3. {'title': 'Simplify Inside the Brackets', 'description': 'Combine like terms inside the brackets:\n$$(8x + 6) - (2x + 10) = 6x - 4$$\nSo the equation becomes:\n$$44 = \\frac{1}{2}(6x - 4)$$'}
  4. {'title': 'Solve for $x$', 'description': 'Multiply both sides by $2$ to clear the fraction:\n$$88 = 6x - 4$$\nAdd $4$ to both sides:\n$$92 = 6x$$\nDivide both sides by $6$:\n$$x = \\frac{92}{6} = \\frac{46}{3}$$'}
  5. {'title': 'Find Arc $\\overset{\\frown}{TB}$', 'description': 'Substitute $x = \\dfrac{46}{3}$ back into the far-arc expression:\n$$\\overset{\\frown}{TB} = 8\\left(\\frac{46}{3}\\right) + 6 = \\frac{368}{3} + \\frac{18}{3} = \\frac{386}{3} \\approx 128.\\overline{6}°$$\n\n**Quick check:** Near arc $\\overset{\\frown}{TA} = 2\\left(\\dfrac{46}{3}\\right)+10 = \\dfrac{92}{3}+\\dfrac{30}{3} = \\dfrac{122}{3}°$\n\nDifference: $\\dfrac{386}{3} - \\dfrac{122}{3} = \\dfrac{264}{3} = 88°$, and $\\dfrac{88}{2} = 44°$ ✓'}


### Q2 · hard · frq · NO figure · status=approved

**Question:** From external point $P$, two secants are drawn to circle $O$. The first secant intersects the circle at points $A$ and $B$, with $PA = x + 2$ and $PB = 3x$. The second secant intersects the circle at points $C$ and $D$, with $PC = x$ and $PD = x + 9$. Using the Power of a Point theorem (secant–secant case), set up and solve an equation to find the exact value of $x$, then compute $PB$.

**Final answer:** $PB = \dfrac{9}{2}$

**Solution steps:**
  1. {'title': 'Understand the Setup', 'description': 'We have an external point $P$ and a circle $O$. Two secants shoot from $P$ through the circle:\n\n- **Secant 1** hits the circle at $A$ (near) then $B$ (far): $PA = x+2$, $PB = 3x$\n- **Secant 2** hits the circle at $C$ (near) then $D$ (far): $PC = x$, $PD = x+9$\n\nThe **Power of a Point** theorem says: for any two secants from the same external point, the product of the two distances on one secant equals the product on the other:\n$$PA \\cdot PB = PC \\cdot PD$$\nThis works because both products equal the same fixed "power" of point $P$ with respect to the circle — a quantity that depends only on $P$\'s distance from the center, not on which secant you draw. Think of it as each secant "measuring" the same thing about the circle from $P$\'s perspective.', 'figure_svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3.1000 -3.1000 6.2000 6.2000" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Geometry figure"><g transform="scale(1,-1)"><circle cx="0" cy="0" r="2.5000" fill="none" stroke="currentColor" stroke-width="0.04"/><line x1="-2.2658" y1="1.0565" x2="-2.4148" y2="-0.6470" stroke="currentColor" stroke-width="0.04"/><line x1="2.1651" y1="1.2500" x2="2.4148" y2="-0.6470" stroke="currentColor" stroke-width="0.04"/><circle cx="0" cy="0" r="0.0375" fill="currentColor"/><circle cx="-2.2658" cy="1.0565" r="0.0375" fill="currentColor"/><circle cx="-2.4148" cy="-0.6470" r="0.0375" fill="currentColor"/><circle cx="2.1651" cy="1.2500" r="0.0375" fill="currentColor"/><circle cx="2.4148" cy="-0.6470" r="0.0375" fill="currentColor"/></g><text x="0.0000" y="0.0000" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor" dx="0.1500" dy="0.2500">O</text><text x="-2.4652" y="-1.1495" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">A</text><text x="-2.6273" y="0.7040" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">B</text><text x="2.3556" y="-1.3600" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">C</text><text x="2.6273" y="0.7040" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">D</text></svg>', 'figure_spec': {'type': 'geometry', 'shape': 'circle', 'radius': 3, 'show_center': True, 'center_label': 'O', 'points': {'A': 155, 'B': 195, 'C': 30, 'D': 345}, 'chords': ['AB', 'CD'], 'point_labels': {'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D'}}}
  2. {'title': 'Write the Equation', 'description': 'Plug the four expressions directly into $PA \\cdot PB = PC \\cdot PD$:\n$$(x+2)(3x) = x(x+9)$$\nExpanding both sides:\n$$3x^2 + 6x = x^2 + 9x$$'}
  3. {'title': 'Solve for x', 'description': 'Move everything to one side:\n$$3x^2 + 6x - x^2 - 9x = 0$$\n$$2x^2 - 3x = 0$$\n\nFactor out $x$:\n$$x(2x - 3) = 0$$\n\nThis gives $x = 0$ or $x = \\dfrac{3}{2}$.\n\nSince $x = 0$ would make $PC = 0$ (meaning $P$ sits on the circle, contradicting "external point"), we must take:\n$$x = \\frac{3}{2}$$'}
  4. {'title': 'Compute PB', 'description': 'Substitute $x = \\dfrac{3}{2}$ into $PB = 3x$:\n$$PB = 3 \\times \\frac{3}{2} = \\frac{9}{2}$$\n\nAs a quick **sanity check**, verify both sides of the original equation are equal:\n- $PA \\cdot PB = \\left(\\frac{3}{2}+2\\right)\\cdot\\frac{9}{2} = \\frac{7}{2}\\cdot\\frac{9}{2} = \\frac{63}{4}$\n- $PC \\cdot PD = \\frac{3}{2}\\cdot\\left(\\frac{3}{2}+9\\right) = \\frac{3}{2}\\cdot\\frac{21}{2} = \\frac{63}{4}$ ✓'}


### Q3 · easy · frq · figure ✔ · status=pending

**Question:** In the diagram, points $A$, $B$, and $C$ lie on circle $O$. Arc $AC$ (not containing $B$) measures $arc\,AC = (6x + 4)°$, and the inscribed angle $\angle ABC = (2x + 15)°$. Set up and solve an equation to find $m\angle ABC$.

**Final answer:** $m\angle ABC = 41°$

**Solution steps:**
  1. {'title': 'Understand the Setup', 'description': 'We have three points $A$, $B$, $C$ on circle $O$. The **inscribed angle** $\\angle ABC$ has its vertex on the circle and its two sides are chords that cut off arc $AC$ (the arc not containing $B$). That arc is the **intercepted arc** for this angle.\n\nThe key relationship to use: the **Inscribed Angle Theorem** says an inscribed angle equals exactly **half** its intercepted arc. Written as a formula:\n$$\\angle ABC = \\frac{1}{2} \\cdot \\overset{\\frown}{AC}$$\nThis immediately lets us set up one equation in one unknown $x$.', 'figure_svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3.1000 -3.1000 6.2000 6.2000" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Geometry figure"><g transform="scale(1,-1)"><circle cx="0" cy="0" r="2.5000" fill="none" stroke="currentColor" stroke-width="0.04"/><line x1="-2.3492" y1="-0.8551" x2="0.8551" y2="2.3492" stroke="currentColor" stroke-width="0.04"/><line x1="0.8551" y1="2.3492" x2="1.9151" y2="-1.6070" stroke="currentColor" stroke-width="0.04"/><circle cx="0" cy="0" r="0.0375" fill="currentColor"/><circle cx="-2.3492" cy="-0.8551" r="0.0375" fill="currentColor"/><circle cx="0.8551" cy="2.3492" r="0.0375" fill="currentColor"/><circle cx="1.9151" cy="-1.6070" r="0.0375" fill="currentColor"/></g><text x="0.0000" y="0.0000" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor" dx="0.1500" dy="0.2500">O</text><text x="-2.5560" y="0.9303" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">A</text><text x="0.9303" y="-2.5560" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">B</text><text x="2.0836" y="1.7484" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">C</text></svg>', 'figure_spec': {'type': 'geometry', 'shape': 'circle', 'radius': 3, 'show_center': True, 'center_label': 'O', 'points': {'A': 200, 'B': 70, 'C': 320}, 'chords': ['AB', 'BC'], 'chord_labels': {}}}
  2. {'title': 'Set Up the Equation', 'description': 'Substitute the given expressions into the Inscribed Angle Theorem:\n$$\\underbrace{(2x + 15)}_{\\angle ABC} = \\frac{1}{2} \\cdot \\underbrace{(6x + 4)}_{\\overset{\\frown}{AC}}$$\nMultiply both sides by $2$ to clear the fraction:\n$$2(2x + 15) = 6x + 4$$\n$$4x + 30 = 6x + 4$$'}
  3. {'title': 'Solve for $x$', 'description': 'Collect the $x$-terms on one side and constants on the other:\n$$30 - 4 = 6x - 4x$$\n$$26 = 2x$$\n$$x = 13$$'}
  4. {'title': 'Find $m\\angle ABC$', 'description': 'Substitute $x = 13$ back into the expression for the inscribed angle:\n$$m\\angle ABC = 2(13) + 15 = 26 + 15 = 41°$$\n\n**Quick check:** Arc $AC = 6(13) + 4 = 82°$, and $\\frac{1}{2}(82°) = 41°$ ✓'}


### Q4 · medium · mcq · figure ✔ · status=approved

**Question:** Two secants are drawn from external point $P$ to a circle. The first secant passes through the circle and has an external segment of length $4$ and a whole secant length of $9$. The second secant has an external segment of length $3$. Find the whole length of the second secant.

**Distractors (wrong choices):** ['$x = 9$', '$x = 10.5$', '$x = 16$']

**Final answer:** $x = 12$

**Solution steps:**
  1. {'title': 'Understand the Setup', 'description': 'We have an external point $P$ with two secants drawn into a circle.\n\n- **Secant 1:** external segment $= 4$, whole length $= 9$\n- **Secant 2:** external segment $= 3$, whole length $= ?$\n\nThe key relationship here is the **Secant-Secant Power of a Point theorem**: when two secants are drawn from the same external point, the product of one secant\'s external segment and its whole length equals the same product for the other secant.\n\n$$\\text{(external}_1) \\times \\text{(whole}_1) = \\text{(external}_2) \\times \\text{(whole}_2)$$\n\nThink of it like a balance scale — both sides represent the same "power" of point $P$ with respect to the circle, so they must be equal.', 'figure_svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3.6440 -3.6440 7.2880 7.2880" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Geometry figure"><g transform="scale(1,-1)"><circle cx="0" cy="0" r="2.5000" fill="none" stroke="currentColor" stroke-width="0.04"/><line x1="-1.9151" y1="1.6070" x2="-2.3492" y2="-0.8551" stroke="currentColor" stroke-width="0.04"/><line x1="1.9151" y1="1.6070" x2="1.9151" y2="-1.6070" stroke="currentColor" stroke-width="0.04"/><circle cx="-1.9151" cy="1.6070" r="0.0375" fill="currentColor"/><circle cx="-2.3492" cy="-0.8551" r="0.0375" fill="currentColor"/><circle cx="1.9151" cy="1.6070" r="0.0375" fill="currentColor"/><circle cx="1.9151" cy="-1.6070" r="0.0375" fill="currentColor"/></g><text x="-2.0836" y="-1.7484" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">A</text><text x="-2.5560" y="0.9303" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">B</text><text x="2.0836" y="-1.7484" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">C</text><text x="2.0836" y="1.7484" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">D</text><text x="-2.3488" y="-0.4142" font-family="system-ui, sans-serif" font-size="0.2200" text-anchor="middle" dominant-baseline="middle" fill="currentColor">chord 1</text><text x="2.1351" y="0.0000" font-family="system-ui, sans-serif" font-size="0.2200" text-anchor="middle" dominant-baseline="middle" fill="currentColor">chord 2</text></svg>', 'figure_spec': {'type': 'geometry', 'shape': 'circle', 'radius': 3, 'show_center': False, 'points': {'A': 140, 'B': 200, 'C': 40, 'D': 320}, 'chords': ['AB', 'CD'], 'chord_labels': {'AB': 'chord 1', 'CD': 'chord 2'}, 'point_labels': {'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D'}}}
  2. {'title': 'Plug In Known Values', 'description': 'Let the unknown whole length of the second secant be $x$. Substituting into the theorem:\n\n$$4 \\times 9 = 3 \\times x$$\n\n$$36 = 3x$$'}
  3. {'title': 'Solve for $x$', 'description': 'Divide both sides by $3$:\n\n$$x = \\frac{36}{3} = 12$$'}


### Q5 · easy · mcq · figure ✔ · status=approved

**Question:** In the diagram, points $A$, $B$, and $C$ lie on circle $O$. Arc $AC$ (not containing $B$) measures $134°$. Find $m\angle ABC$.

**Distractors (wrong choices):** ['$m\\angle ABC = 134°$', '$m\\angle ABC = 46°$', '$m\\angle ABC = 113°$']

**Final answer:** $m\angle ABC = 67°$

**Solution steps:**
  1. {'title': 'Understand the Setup', 'description': 'We have three points $A$, $B$, $C$ on circle $O$, with $\\angle ABC$ formed at point $B$. This makes $\\angle ABC$ an **inscribed angle** — an angle whose vertex sits on the circle and whose two sides are chords of the circle ($BA$ and $BC$).\n\nThe key rule to reach for whenever you see an angle whose vertex is ON the circle: the **Inscribed Angle Theorem**.\n\n> An inscribed angle equals **half** of the arc it intercepts.\n\nThe arc that $\\angle ABC$ intercepts is arc $AC$ — specifically the arc that does *not* contain $B$ (the arc "across" from $B$).', 'figure_svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3.1000 -3.1000 6.2000 6.2000" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Geometry figure"><g transform="scale(1,-1)"><circle cx="0" cy="0" r="2.5000" fill="none" stroke="currentColor" stroke-width="0.04"/><line x1="-2.3492" y1="0.8551" x2="1.6070" y2="-1.9151" stroke="currentColor" stroke-width="0.04"/><line x1="1.6070" y1="-1.9151" x2="2.2470" y2="1.0959" stroke="currentColor" stroke-width="0.04"/><circle cx="0" cy="0" r="0.0375" fill="currentColor"/><circle cx="-2.3492" cy="0.8551" r="0.0375" fill="currentColor"/><circle cx="1.6070" cy="-1.9151" r="0.0375" fill="currentColor"/><circle cx="2.2470" cy="1.0959" r="0.0375" fill="currentColor"/></g><text x="0.0000" y="0.0000" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor" dx="0.1500" dy="0.2500">O</text><text x="-2.5560" y="-0.9303" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">A</text><text x="1.7484" y="2.0836" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">B</text><text x="2.4447" y="-1.1924" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">C</text></svg>', 'figure_spec': {'type': 'geometry', 'shape': 'circle', 'radius': 3, 'show_center': True, 'center_label': 'O', 'points': {'A': 160, 'B': 310, 'C': 26}, 'chords': ['AB', 'BC'], 'chord_labels': {}}}
  2. {'title': 'Apply Inscribed Angle Theorem', 'description': 'The intercepted arc is arc $AC$ (not containing $B$), which measures $134°$.\n\nBy the Inscribed Angle Theorem:\n$$m\\angle ABC = \\frac{1}{2} \\times (\\text{intercepted arc})$$\n$$m\\angle ABC = \\frac{1}{2} \\times 134° = 67°$$'}


## Calculus (Accelerated) — Unit: Applications of the Derivative

_Counts: {'pending': 0, 'approved': 5, 'rejected': 0, 'archived': 0}_


### Q1 · medium · frq · NO figure · status=approved

**Question:** A rancher plans to build a rectangular holding pen along the straight bank of a river (so no fence is needed on the river side). The pen must enclose an area of $1{,}800$ m². Fencing for the two sides perpendicular to the river costs $\$12$ per meter, and fencing for the single side parallel to the river (opposite the bank) costs $\$8$ per meter.

**(a)** Define variables for the dimensions of the pen and write the objective function (total cost) together with the constraint.

**(b)** Express the cost as a function of a single variable and find its critical point(s).

**(c)** Use the first or second derivative test to confirm that the critical point is a minimum, and state the dimensions and minimum cost, rounded to 3 significant figures.

**Final answer:** $x = 10\sqrt{6} \approx 24.5\ \text{m},\quad y = 30\sqrt{6} \approx 73.5\ \text{m},\quad C_{\min} = 480\sqrt{6} \approx \$1{,}180$

**Solution steps:**
  1. {'title': 'Understand the Setup', 'description': 'We have a rectangle bordered by a river on one side. The river side needs no fence, so we pay for:\n- **Two sides** perpendicular to the river (the "widths") at $\\$12$/m each\n- **One side** parallel to the river (the "length") at $\\$8$/m\n\nThe key insight for optimization problems like this: write cost in terms of **two** variables, then use the area constraint to eliminate one, leaving a single-variable function we can minimize with calculus. Watch for the asymmetric cost structure — the two sides share a rate while the one parallel side has its own rate.', 'figure_svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.8040 -4.3040 8.6080 6.1080" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Geometry figure"><g transform="scale(1,-1)"><polygon points="0.0000,0.0000 0.0000,2.5000 5.0000,2.5000 5.0000,0.0000" fill="none" stroke="currentColor" stroke-width="0.04" stroke-linejoin="round"/></g><text x="-0.1968" y="0.0984" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">A</text><text x="-0.1968" y="-2.5984" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">B</text><text x="5.1968" y="-2.5984" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">C</text><text x="5.1968" y="0.0984" font-family="system-ui, sans-serif" font-size="0.2800" text-anchor="middle" dominant-baseline="middle" fill="currentColor">D</text><text x="-0.2200" y="-1.2500" font-family="system-ui, sans-serif" font-size="0.2200" text-anchor="middle" dominant-baseline="middle" fill="currentColor">x (\\$12/m)</text><text x="5.2200" y="-1.2500" font-family="system-ui, sans-serif" font-size="0.2200" text-anchor="middle" dominant-baseline="middle" fill="currentColor">x (\\$12/m)</text><text x="2.5000" y="-2.7200" font-family="system-ui, sans-serif" font-size="0.2200" text-anchor="middle" dominant-baseline="middle" fill="currentColor">y (\\$8/m)</text><text x="2.5000" y="0.2200" font-family="system-ui, sans-serif" font-size="0.2200" text-anchor="middle" dominant-baseline="middle" fill="currentColor">River (free)</text></svg>', 'figure_spec': {'type': 'geometry', 'shape': 'polygon', 'vertex_positions': [[0, 0], [0, 3], [6, 3], [6, 0]], 'vertex_names': ['A', 'B', 'C', 'D'], 'side_labels': {'AB': 'x (\\$12/m)', 'CD': 'x (\\$12/m)', 'BC': 'y (\\$8/m)', 'DA': 'River (free)'}}}
  2. {'title': 'Part (a): Variables, Constraint & Objective', 'description': 'Let:\n- $x$ = the length of each side **perpendicular** to the river (m)\n- $y$ = the length of the side **parallel** to the river (m)\n\n**Constraint** (area must be 1,800 m²):\n$$xy = 1800$$\n\n**Objective function** (total fencing cost):\n$$C = 2(12)x + 8y = 24x + 8y$$\nThe factor of 2 appears because there are two perpendicular sides.'}
  3. {'title': 'Part (b): Single-Variable Cost Function', 'description': "Solve the constraint for $y$:\n$$y = \\frac{1800}{x}$$\n\nSubstitute into $C$:\n$$C(x) = 24x + 8 \\cdot \\frac{1800}{x} = 24x + \\frac{14{,}400}{x}$$\n\nThis is valid for $x > 0$. Now find the critical point by setting $C'(x) = 0$:\n$$C'(x) = 24 - \\frac{14{,}400}{x^2} = 0$$\n$$x^2 = \\frac{14{,}400}{24} = 600$$\n$$\\boxed{x = \\sqrt{600} = 10\\sqrt{6} \\approx 24.5 \\text{ m}}$$\n\nThis is the only critical point on $(0, \\infty)$."}
  4. {'title': 'Part (c): Confirm Minimum & State Answer', 'description': "**Second Derivative Test:**\n$$C''(x) = \\frac{28{,}800}{x^3}$$\n\nSince $x > 0$, we have $C''(x) > 0$ for all valid $x$, so $C(x)$ is **concave up** everywhere — confirming the critical point is a **global minimum**.\n\n**Dimensions:**\n$$x = 10\\sqrt{6} \\approx 24.5 \\text{ m (perpendicular sides)}$$\n$$y = \\frac{1800}{10\\sqrt{6}} = 30\\sqrt{6} \\approx 73.5 \\text{ m (parallel side)}$$\n\nNotice that $y = 3x$: the optimal parallel side is exactly 3 times the perpendicular side — a clean ratio that reflects how the costs balance out.\n\n**Minimum Cost:**\n$$C = 24(10\\sqrt{6}) + \\frac{14{,}400}{10\\sqrt{6}} = 240\\sqrt{6} + 240\\sqrt{6} = 480\\sqrt{6} \\approx \\$1{,}180$$\n\nAt the optimum, cost splits **evenly** between the perpendicular sides and the parallel side — a hallmark of well-structured optimization problems."}


### Q2 · easy · frq · NO figure · status=approved

**Question:** A stone is dropped into a calm lake, producing a circular ripple whose radius expands at a constant rate of $3.5$ cm/s.

**(a)** Define all relevant variables and state the equation relating them.

**(b)** Differentiate your equation with respect to time.

**(c)** At the instant the radius is $12$ cm, how fast is the area of the circular ripple increasing? Express your answer in cm²/s, rounded to 3 significant figures.

**Final answer:** $\dfrac{dA}{dt} = 84\pi \approx 264 \text{ cm}^2/\text{s}$

**Solution steps:**
  1. {'title': 'Understand the Problem', 'description': 'A circular ripple grows outward over time. We know **how fast the radius is growing** and want to find **how fast the area is growing** at a specific moment.\n\nThis is a **related rates** problem — two quantities (radius $r$ and area $A$) both change with time, and their rates of change are linked through the formula for the area of a circle. The key insight: differentiate that area formula with respect to time $t$ to connect $\\frac{dr}{dt}$ (given) to $\\frac{dA}{dt}$ (what we want).'}
  2. {'title': 'Part (a): Define Variables', 'description': 'Let:\n- $t$ = time (seconds)\n- $r = r(t)$ = radius of the ripple at time $t$ (cm)\n- $A = A(t)$ = area of the ripple at time $t$ (cm²)\n\nThe equation relating them is the area of a circle:\n$$A = \\pi r^2$$\n\nThe known rate is $\\dfrac{dr}{dt} = 3.5$ cm/s.'}
  3. {'title': 'Part (b): Differentiate with Respect to Time', 'description': 'Differentiate both sides of $A = \\pi r^2$ with respect to $t$, using the **Chain Rule** on the right side (since $r$ is itself a function of $t$):\n$$\\frac{dA}{dt} = 2\\pi r \\cdot \\frac{dr}{dt}$$\n\nThis equation says: the rate of area growth equals $2\\pi r$ times the rate of radius growth. The faster the radius grows *or* the larger $r$ already is, the faster the area expands.'}
  4. {'title': 'Part (c): Substitute Known Values', 'description': 'At the instant $r = 12$ cm, substitute $r = 12$ and $\\dfrac{dr}{dt} = 3.5$ into the differentiated equation:\n$$\\frac{dA}{dt} = 2\\pi (12)(3.5) = 84\\pi$$\n\nEvaluating numerically:\n$$\\frac{dA}{dt} = 84\\pi \\approx 263.893\\ldots \\approx \\mathbf{264} \\text{ cm}^2\\text{/s}$$'}


### Q3 · hard · frq · NO figure · status=approved

**Question:** A 10-meter ladder leans against a vertical wall. The base of the ladder slides away from the wall at a rate of $0.4$ m/s.

**(a)** Define variables for the horizontal distance from the wall to the base of the ladder and the vertical height of the top of the ladder. Write the equation relating them.

**(b)** Differentiate with respect to time and find the rate at which the top of the ladder is sliding down the wall at the instant the base is $6$ m from the wall. Express your answer in m/s, rounded to 3 significant figures.

**(c)** The area of the triangle formed by the ladder, wall, and ground is $A = \frac{1}{2}xy$, where $x$ is the base distance and $y$ is the wall height. Using your expressions for $x$, $y$, and their rates from parts (a) and (b), find $\frac{dA}{dt}$ at the instant the base is $6$ m from the wall. Then, treating $x$ as the independent variable (with $x$ ranging over $(0, 10)$), determine the value of $x$ at which the area $A(x)$ is maximized and confirm it is a maximum. State both the rate $\frac{dA}{dt}$ at $x = 6$ m and the maximum area, each rounded to 3 significant figures.

**Final answer:** **Summary of results:**

**(a)** Let $x$ = base distance, $y$ = wall height. The constraint is:
$$x^2 + y^2 = 100$$

**(b)** Rate of descent of the ladder's top at $x = 6$ m:
$$\frac{dy}{dt} = -\frac{x}{y}\cdot\frac{dx}{dt} = -\frac{6}{8}(0.4) = -0.300 \text{ m/s}$$

**(c)** Rate of change of triangle area at $x = 6$ m:
$$\frac{dA}{dt} = 0.700 \text{ m}^2\text{/s}$$

Maximum area (achieved at $x = 5\sqrt{2} \approx 7.07$ m):
$$A_{\max} = 25.0 \text{ m}^2$$

**Solution steps:**
  1. {'title': 'Understand the Setup', 'description': "We have a 10 m ladder, a vertical wall, and the ground forming a right triangle. The ladder is the hypotenuse (always length 10 m), the ground leg grows as the base slides out, and the wall leg shrinks as the top slides down.\n\nThe key insight: **the ladder length is constant**, which is what links the horizontal and vertical changes. We'll use the Pythagorean theorem to write that constraint, then differentiate it with respect to time — a technique called **related rates** — to connect the rates of change."}
  2. {'title': 'Define Variables & Equation', 'description': "Let:\n- $x$ = horizontal distance (m) from the wall to the base of the ladder\n- $y$ = vertical height (m) of the top of the ladder on the wall\n- $t$ = time (s)\n\nBoth $x$ and $y$ are **functions of time**. The ladder's fixed length gives the constraint:\n\n$$x^2 + y^2 = 10^2 = 100$$\n\nThis is the equation relating $x$ and $y$ at every instant."}
  3. {'title': 'Differentiate with Respect to Time', 'description': 'Differentiate both sides of $x^2 + y^2 = 100$ with respect to $t$, using the **chain rule** on each term (since both $x$ and $y$ depend on $t$):\n\n$$2x\\frac{dx}{dt} + 2y\\frac{dy}{dt} = 0$$\n\nDivide through by 2 and isolate $\\frac{dy}{dt}$:\n\n$$\\frac{dy}{dt} = -\\frac{x}{y}\\cdot\\frac{dx}{dt}$$\n\nThe negative sign confirms that as $x$ **increases** (base slides out), $y$ **decreases** (top slides down) — physically correct.'}
  4. {'title': 'Find y at x = 6 m', 'description': 'Substitute $x = 6$ into the Pythagorean constraint to find the corresponding wall height:\n\n$$y = \\sqrt{100 - 6^2} = \\sqrt{100 - 36} = \\sqrt{64} = 8 \\text{ m}$$\n\nSo at this instant: $x = 6$ m, $y = 8$ m — a classic 6-8-10 right triangle (a scaled 3-4-5).'}
  5. {'title': 'Compute dy/dt at x = 6 m', 'description': 'We know $\\frac{dx}{dt} = 0.4$ m/s, $x = 6$ m, $y = 8$ m. Substitute:\n\n$$\\frac{dy}{dt} = -\\frac{x}{y}\\cdot\\frac{dx}{dt} = -\\frac{6}{8}\\times 0.4 = -\\frac{2.4}{8} = -0.3 \\text{ m/s}$$\n\nThe top of the ladder is sliding **down** at $\\mathbf{0.300}$ **m/s** when the base is 6 m from the wall.'}
  6. {'title': 'Find dA/dt at x = 6 m', 'description': "The triangle's area is $A = \\frac{1}{2}xy$. Differentiate with respect to $t$ using the **product rule**:\n\n$$\\frac{dA}{dt} = \\frac{1}{2}\\left(\\frac{dx}{dt}\\cdot y + x\\cdot\\frac{dy}{dt}\\right)$$\n\nSubstitute all known values ($x=6$, $y=8$, $\\frac{dx}{dt}=0.4$, $\\frac{dy}{dt}=-0.3$):\n\n$$\\frac{dA}{dt} = \\frac{1}{2}\\bigl((0.4)(8) + (6)(-0.3)\\bigr) = \\frac{1}{2}(3.2 - 1.8) = \\frac{1.4}{2} = \\mathbf{0.700 \\text{ m}^2\\text{/s}}$$\n\nAt this instant the triangle's area is **growing** — the base is expanding faster than the height is shrinking."}
  7. {'title': 'Maximize A(x) Over (0, 10)', 'description': "Express $A$ purely as a function of $x$ by substituting $y = \\sqrt{100 - x^2}$:\n\n$$A(x) = \\frac{1}{2}x\\sqrt{100 - x^2}, \\quad x \\in (0, 10)$$\n\nDifferentiate and set $A'(x) = 0$. Using the product rule:\n\n$$A'(x) = \\frac{1}{2}\\cdot\\frac{100 - 2x^2}{\\sqrt{100-x^2}}$$\n\nThe numerator is what can equal zero (the denominator is always positive on the open interval):\n\n$$100 - 2x^2 = 0 \\implies x^2 = 50 \\implies x = 5\\sqrt{2} \\approx 7.07 \\text{ m}$$\n\n**Confirming it's a maximum:** $A'(x) > 0$ for $x < 5\\sqrt{2}$ and $A'(x) < 0$ for $x > 5\\sqrt{2}$, so this is a genuine **global maximum** on $(0,10)$.\n\nAt $x = 5\\sqrt{2}$, the corresponding height is:\n$$y = \\sqrt{100 - 50} = \\sqrt{50} = 5\\sqrt{2}$$\n\nNote that $x = y = 5\\sqrt{2}$: **the area is maximized when the triangle is isosceles** (base = height), a clean geometric insight.\n\nThe maximum area:\n$$A_{\\max} = \\frac{1}{2}(5\\sqrt{2})(5\\sqrt{2}) = \\frac{1}{2}\\times 50 = \\mathbf{25.0 \\text{ m}^2}$$"}


### Q4 · hard · mcq · NO figure · status=approved

**Question:** A company needs to manufacture an open-top rectangular box with a square base. The box must have a volume of exactly 32,000 cm³. The material for the base costs $0.08 per cm², and the material for the four sides costs $0.05 per cm². What side length (in cm) of the square base minimizes the total material cost of the box? Express your answer as a decimal to 3 significant figures.

**Distractors (wrong choices):** ['$x = 40$ cm', '$x = 10\\sqrt[3]{5} \\approx 17.1$ cm', '$x = 20\\sqrt[3]{2} \\approx 25.2$ cm']

**Final answer:** $x = 20\sqrt[3]{5} \approx 34.2 \text{ cm}$

**Solution steps:**
  1. {'title': 'Understand the Problem', 'description': 'We have an open-top box with a **square base** of side $x$ and height $h$. Two constraints drive the math:\n\n1. **Volume** is fixed: $x^2 h = 32{,}000$\n2. **Cost** depends on area — base costs more per cm² than the sides.\n\nThe key insight: volume ties $h$ to $x$, so we can eliminate $h$ and write cost as a **single-variable function** of $x$. Then minimizing is just setting the derivative to zero.\n\n**Watch for:** a term that grows with $x$ (base area) fighting a term that shrinks with $x$ (side area, because taller boxes get cheaper bases). The minimum sits where these forces balance.'}
  2. {'title': 'Express h via Volume', 'description': 'From $x^2 h = 32{,}000$, solve for $h$:\n$$h = \\frac{32{,}000}{x^2}$$\nEvery quantity in the cost function will now be written purely in terms of $x$.'}
  3. {'title': 'Build the Cost Function', 'description': '**Base** (one square, area $x^2$, rate $\\$0.08$):\n$$C_{\\text{base}} = 0.08x^2$$\n\n**Four sides** (each rectangle $x \\times h$, rate $\\$0.05$):\n$$C_{\\text{sides}} = 0.05 \\times 4xh = 0.20 \\cdot x \\cdot \\frac{32{,}000}{x^2} = \\frac{6{,}400}{x}$$\n\nTotal cost:\n$$C(x) = 0.08x^2 + \\frac{6{,}400}{x}$$\n\nThe first term grows as $x$ increases (bigger base), the second shrinks (shorter, cheaper sides). The minimum is somewhere in between.'}
  4. {'title': 'Differentiate and Set to Zero', 'description': "$$C'(x) = 0.16x - \\frac{6{,}400}{x^2}$$\n\nSet $C'(x) = 0$:\n$$0.16x = \\frac{6{,}400}{x^2}$$\n\nMultiply both sides by $x^2$:\n$$0.16x^3 = 6{,}400$$\n$$x^3 = \\frac{6{,}400}{0.16} = 40{,}000$$"}
  5. {'title': 'Solve for x', 'description': '$$x = \\sqrt[3]{40{,}000}$$\n\nFactor to simplify: $40{,}000 = 8 \\times 5{,}000 = 8 \\times 5 \\times 1{,}000$, so\n$$x = 2\\sqrt[3]{5{,}000} = 2 \\times 10\\sqrt[3]{5} = 20\\sqrt[3]{5}$$\n\nNumerically: $\\sqrt[3]{5} \\approx 1.70998$, giving\n$$x = 20 \\times 1.70998 \\approx 34.1995\\ldots \\text{ cm}$$\n\nTo 3 significant figures: $x \\approx \\mathbf{34.2}$ **cm**.'}
  6. {'title': "Confirm It's a Minimum", 'description': "The second derivative confirms this is a **minimum**, not a maximum:\n$$C''(x) = 0.16 + \\frac{12{,}800}{x^3}$$\n\nSince both terms are strictly positive for all $x > 0$, we have $C''(x) > 0$ everywhere — the cost curve is **concave up**, so $x = 20\\sqrt[3]{5}$ is indeed a global minimum."}


### Q5 · medium · mcq · NO figure · status=approved

**Question:** A 13-meter ladder leans against a vertical wall. The base of the ladder is being pulled away from the wall at a constant rate of 0.5 m/s. At the instant when the base of the ladder is 5 meters from the wall, how fast (in m/s) is the top of the ladder sliding down the wall? Express your answer as a decimal to 3 significant figures.

**Distractors (wrong choices):** ['$0.192$', '$0.260$', '$-0.167$']

**Final answer:** $\dfrac{dy}{dt} = -\dfrac{5}{24} \approx -0.208 \text{ m/s}$

The top of the ladder slides **down** the wall at $0.208$ m/s.

**Solution steps:**
  1. {'title': 'Understand the Problem', 'description': "We have a 13 m ladder leaning against a wall. The base slides away from the wall at $\\frac{dx}{dt} = 0.5$ m/s, and we want $\\frac{dy}{dt}$ — how fast the top slides **down** — when the base is $x = 5$ m from the wall.\n\nThe ladder's length never changes, so the horizontal distance $x$ and vertical height $y$ are always connected by the **Pythagorean theorem**: $$x^2 + y^2 = 13^2$$\nThis is our key equation. Differentiating it with respect to time links the rates $\\frac{dx}{dt}$ and $\\frac{dy}{dt}$ together."}
  2. {'title': 'Find y at the Instant', 'description': 'At the instant when $x = 5$ m, plug into the Pythagorean equation to find the height $y$: $$5^2 + y^2 = 13^2$$ $$25 + y^2 = 169$$ $$y^2 = 144 \\implies y = 12 \\text{ m}$$\nNotice the **5–12–13 right triangle** — a classic Pythagorean triple that makes the arithmetic clean.'}
  3. {'title': 'Differentiate with Respect to Time', 'description': 'Differentiate both sides of $x^2 + y^2 = 169$ with respect to time $t$. The constant 169 vanishes, and the **chain rule** gives a rate on each variable: $$2x\\frac{dx}{dt} + 2y\\frac{dy}{dt} = 0$$\nDividing through by 2: $$x\\frac{dx}{dt} + y\\frac{dy}{dt} = 0$$\nThis equation says: as $x$ grows, $y$ must shrink at exactly the compensating rate to keep the ladder length fixed.'}
  4. {'title': 'Solve for dy/dt', 'description': 'Isolate $\\frac{dy}{dt}$: $$\\frac{dy}{dt} = -\\frac{x}{y}\\cdot\\frac{dx}{dt}$$\nSubstitute $x = 5$, $y = 12$, $\\frac{dx}{dt} = 0.5$: $$\\frac{dy}{dt} = -\\frac{5}{12} \\times 0.5 = -\\frac{2.5}{12} \\approx -0.20833\\ldots \\text{ m/s}$$\nThe **negative sign** confirms the top is moving **downward**. The speed of descent is $|\\frac{dy}{dt}| \\approx 0.208$ m/s.'}
