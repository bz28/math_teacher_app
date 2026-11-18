"""The demo class itself: three trig homeworks and what five students
turned in, as `seed_demo_school.py` writes them.

Everything the AI would have produced — the reader's transcript, the
grader's per-problem calls, the understanding-check conversations and
verdicts, the silent per-problem diagnoses — is authored here by hand.
Nothing in this file is copied from real student data.

The shape of the class at "now" (everyone in Period 2):
  4.2  graded, approved and published for all five.
  4.4  graded, approved and published for all five; fake_4 turned it
       in a day late (−10%).
  5.1  open, due Friday. fake_1, fake_2 and fake_4 turned in early and are
       AI-graded, waiting on the teacher (fake_2's check is flagged: the
       page is right but they couldn't explain it); fake_3 is approved
       but not published; fake_5 hasn't turned it in yet.
  The weak spot is the quadrant setting the sign. On 4.2 #4, csc(7π/6),
  fake_1, fake_3 and fake_4 take sin(7π/6) as +1/2 and score under half:
  3 of 5 counted, which Insights flags (more than half wrong, at least
  5 counted). On 5.1 #2, sin θ = −1/2, the same three put the π/6
  reference angle in Quadrants I/II, where sine is positive.
"""

from __future__ import annotations

from dataclasses import dataclass

from scripts.demo_school_pages import Line

STUDENTS = ["fake_1", "fake_2", "fake_3", "fake_4", "fake_5"]
SECTION_OF = {name: "Period 2" for name in STUDENTS}

STUCK = "I'm stuck — I'm not sure how to explain this."


# ── Shapes ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Problem:
    title: str
    question: str
    final_answer: str
    difficulty: str
    steps: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class Homework:
    key: str
    title: str
    unit: int
    description: str
    # Whole days before the seed's anchor (11:59 PM Pacific last night);
    # each homework goes out at 8 AM and is due at 11:59 PM.
    created_days_ago: int
    published_days_ago: int
    due_days_ago: int
    grades_published: bool
    problems: tuple[Problem, ...]


@dataclass(frozen=True)
class Grade:
    """The grader's call on one problem, as its tool returns it."""

    status: str  # full | partial | zero
    percent: float
    confidence: float
    reasoning: str
    feedback: str
    # (points_off on the 0-100 scale, reason, step_ref within the problem)
    deductions: tuple[tuple[int, str, int | None], ...] = ()


@dataclass(frozen=True)
class Work:
    """One problem on the page: what's written, the boxed answer the
    reader pulls out, the grade, and — when it's wrong and wasn't the
    one the check talked about — the silent diagnosis."""

    lines: tuple[Line, ...]
    answer: str
    grade: Grade
    diagnosis: tuple[str, str] | None = None


@dataclass(frozen=True)
class Turn:
    role: str  # agent | student
    text: str
    seconds: int | None = None
    engagement: str | None = None
    stuck: bool = False
    tab_outs_ms: tuple[int, ...] = ()
    paste: bool = False


@dataclass(frozen=True)
class Check:
    probe_position: int
    disposition: str
    headline: str
    summary: str
    rubric: dict[str, str]
    reasoning: str
    turns: tuple[Turn, ...]


@dataclass(frozen=True)
class TurnIn:
    student: str
    hw: str
    hours_before_due: float  # negative = late
    state: str  # published | approved | to_review
    confidence: float
    work: tuple[Work, ...]
    check: Check


def full(reasoning: str, feedback: str, confidence: float = 0.96) -> Grade:
    return Grade("full", 100, confidence, reasoning, feedback)


def partial(percent: float, reasoning: str, feedback: str, deductions: tuple[tuple[int, str, int | None], ...],
            confidence: float = 0.9) -> Grade:
    return Grade("partial", percent, confidence, reasoning, feedback, deductions)


def L(latex: str, *, boxed: bool = False, crossed: bool = False) -> Line:  # noqa: N802 — reads like the page
    return Line(latex=latex, boxed=boxed, crossed=crossed)


def B(latex: str) -> Line:  # noqa: N802
    return Line(latex=latex, boxed=True)


def rubric(paraphrase: str, causal: str, *, transfer: str = "not_probed", prediction: str = "not_probed",
           self_correction: str = "not_observed") -> dict[str, str]:
    return {
        "paraphrase_originality": paraphrase,
        "causal_fluency": causal,
        "transfer": transfer,
        "prediction": prediction,
        "authority_resistance": "not_probed",
        "self_correction": self_correction,
    }


def A(text: str) -> Turn:  # noqa: N802
    return Turn("agent", text)


def S(text: str, seconds: int, engagement: str = "answering", **kw: object) -> Turn:  # noqa: N802
    return Turn("student", text, seconds, engagement, **kw)  # type: ignore[arg-type]


def STUCK_TAP(seconds: int) -> Turn:  # noqa: N802
    return Turn("student", STUCK, seconds, "honest_confusion", stuck=True)


# ── Homework ─────────────────────────────────────────────────────────

HW_42 = Homework(
    key="4.2", title="4.2 Unit Circle & Exact Values", unit=4,
    description="Show the reference angle and quadrant for each one. Calculator only on #5.",
    created_days_ago=24, published_days_ago=23, due_days_ago=20, grades_published=True,
    problems=(
        Problem("Exact value of sin(5π/6)", r"Find the exact value of $\sin\left(\frac{5\pi}{6}\right)$.",
                r"$\frac{1}{2}$", "easy", (
                    ("Locate the angle", r"$\frac{5\pi}{6}$ is in Quadrant II; its reference angle is "
                                         r"$\pi - \frac{5\pi}{6} = \frac{\pi}{6}$."),
                    ("Choose the sign", "Sine is positive in Quadrant II."),
                    ("Evaluate", r"$\sin\frac{5\pi}{6} = \sin\frac{\pi}{6} = \frac{1}{2}$"),
                )),
        Problem("Exact value of cos(4π/3)", r"Find the exact value of $\cos\left(\frac{4\pi}{3}\right)$.",
                r"$-\frac{1}{2}$", "easy", (
                    ("Locate the angle", r"$\frac{4\pi}{3}$ is in Quadrant III; its reference angle is "
                                         r"$\frac{4\pi}{3} - \pi = \frac{\pi}{3}$."),
                    ("Choose the sign", "Cosine is negative in Quadrant III."),
                    ("Evaluate", r"$\cos\frac{4\pi}{3} = -\cos\frac{\pi}{3} = -\frac{1}{2}$"),
                )),
        Problem("Exact value of tan(7π/4)", r"Find the exact value of $\tan\left(\frac{7\pi}{4}\right)$.",
                r"$-1$", "medium", (
                    ("Locate the angle", r"$\frac{7\pi}{4}$ is in Quadrant IV with reference angle $\frac{\pi}{4}$."),
                    ("Choose the sign", r"In Quadrant IV $x > 0$ and $y < 0$, so $\tan = \frac{y}{x}$ is negative."),
                    ("Evaluate", r"$\tan\frac{7\pi}{4} = -\tan\frac{\pi}{4} = -1$"),
                )),
        Problem("Exact value of csc(7π/6)", r"Find the exact value of $\csc\left(\frac{7\pi}{6}\right)$.",
                r"$-2$", "medium", (
                    ("Use the reciprocal", r"$\csc\theta = \frac{1}{\sin\theta}$"),
                    ("Locate the angle", r"$\frac{7\pi}{6}$ is in Quadrant III with reference angle $\frac{\pi}{6}$."),
                    ("Find sine", r"Sine is negative in Quadrant III: $\sin\frac{7\pi}{6} = -\frac{1}{2}$."),
                    ("Take the reciprocal", r"$\csc\frac{7\pi}{6} = \frac{1}{-1/2} = -2$"),
                )),
        Problem("Ladder against a wall — find the height",
                r"A 20 ft ladder leans against a vertical wall and makes a $60^\circ$ angle with the ground. "
                r"How high up the wall does the top of the ladder reach? Give the exact value and a decimal "
                r"rounded to the nearest tenth of a foot.",
                r"$h = 10\sqrt{3} \approx 17.3$ ft", "hard", (
                    ("Label the triangle", r"The ladder is the hypotenuse (20 ft); the height $h$ is opposite "
                                           r"the $60^\circ$ angle."),
                    ("Choose the ratio", r"$\sin 60^\circ = \frac{h}{20}$"),
                    ("Solve", r"$h = 20\sin 60^\circ = 20 \cdot \frac{\sqrt{3}}{2} = 10\sqrt{3}$"),
                    ("Approximate", r"$10\sqrt{3} \approx 17.3$ ft"),
                )),
    ),
)

HW_44 = Homework(
    key="4.4", title="4.4 Graphing Sine and Cosine", unit=4,
    description="Label amplitude, period and midline before you answer.",
    created_days_ago=16, published_days_ago=15, due_days_ago=12, grades_published=True,
    problems=(
        Problem("Amplitude and period of 3sin(2x)", r"State the amplitude and period of $y = 3\sin(2x)$.",
                r"Amplitude $3$, period $\pi$", "easy", (
                    ("Amplitude", r"$|A| = |3| = 3$"),
                    ("Period", r"Period $= \frac{2\pi}{|B|} = \frac{2\pi}{2} = \pi$"),
                )),
        Problem("Amplitude, period, midline of −2cos(x/2) + 1",
                r"State the amplitude, period, and midline of $y = -2\cos\left(\frac{x}{2}\right) + 1$.",
                r"Amplitude $2$, period $4\pi$, midline $y = 1$", "medium", (
                    ("Amplitude", r"$|-2| = 2$ — the negative sign reflects the graph but doesn't change the "
                                  r"amplitude."),
                    ("Period", r"$B = \frac{1}{2}$, so the period is $\frac{2\pi}{1/2} = 4\pi$."),
                    ("Midline", r"The vertical shift is $+1$, so the midline is $y = 1$."),
                    ("Answer", r"Amplitude $2$, period $4\pi$, midline $y = 1$."),
                )),
        Problem("Maximum of 4cos x − 1 on [0, 2π]",
                r"Find the maximum value of $y = 4\cos x - 1$ and every $x$ in $[0, 2\pi]$ where it occurs.",
                r"Maximum $3$, at $x = 0$ and $x = 2\pi$", "medium", (
                    ("Range of cosine", r"$-1 \le \cos x \le 1$, so the largest value of $4\cos x$ is $4$."),
                    ("Maximum", r"$y = 4(1) - 1 = 3$"),
                    ("Where", r"$\cos x = 1$ at $x = 0$ and $x = 2\pi$ in $[0, 2\pi]$."),
                )),
        Problem("Ferris wheel — max height and revolution time",
                r"A rider's height above the ground on a Ferris wheel is "
                r"$h(t) = 25 - 20\cos\left(\frac{\pi}{15}t\right)$ feet, where $t$ is in seconds. What is the "
                r"rider's maximum height, and how long does one full revolution take?",
                r"Maximum height $45$ ft; one revolution takes $30$ s", "hard", (
                    ("Maximum height", r"$-20\cos(\cdot)$ is largest when $\cos = -1$: $h = 25 + 20 = 45$ ft."),
                    ("Find B", r"$B = \frac{\pi}{15}$"),
                    ("Period", r"$T = \frac{2\pi}{\pi/15} = 30$ seconds."),
                    ("Answer", r"Maximum height $45$ ft; one revolution takes $30$ s."),
                )),
    ),
)

HW_51 = Homework(
    key="5.1", title="5.1 Solving Basic Trig Equations", unit=5,
    description="Give every solution in [0, 2π). Exact values unless the problem says to round.",
    created_days_ago=5, published_days_ago=4, due_days_ago=-3, grades_published=False,
    problems=(
        Problem("Solve 2cos θ − 1 = 0", r"Solve $2\cos\theta - 1 = 0$ for $0 \le \theta < 2\pi$.",
                r"$\theta = \frac{\pi}{3}, \frac{5\pi}{3}$", "easy", (
                    ("Isolate", r"$\cos\theta = \frac{1}{2}$"),
                    ("Reference angle", r"$\cos\frac{\pi}{3} = \frac{1}{2}$, so the reference angle is "
                                        r"$\frac{\pi}{3}$."),
                    ("Quadrants", r"Cosine is positive in Quadrants I and IV: $\theta = \frac{\pi}{3}$ and "
                                  r"$\theta = 2\pi - \frac{\pi}{3} = \frac{5\pi}{3}$."),
                )),
        Problem("Solve 2sin θ + 1 = 0", r"Solve $2\sin\theta + 1 = 0$ for $0 \le \theta < 2\pi$.",
                r"$\theta = \frac{7\pi}{6}, \frac{11\pi}{6}$", "hard", (
                    ("Isolate", r"$\sin\theta = -\frac{1}{2}$"),
                    ("Reference angle", r"$\sin\frac{\pi}{6} = \frac{1}{2}$, so the reference angle is "
                                        r"$\frac{\pi}{6}$."),
                    ("Quadrants", "Sine is negative in Quadrants III and IV."),
                    ("Solutions", r"$\theta = \pi + \frac{\pi}{6} = \frac{7\pi}{6}$ and "
                                  r"$\theta = 2\pi - \frac{\pi}{6} = \frac{11\pi}{6}$"),
                )),
        Problem("Solve tan θ = √3", r"Solve $\tan\theta = \sqrt{3}$ for $0 \le \theta < 2\pi$.",
                r"$\theta = \frac{\pi}{3}, \frac{4\pi}{3}$", "medium", (
                    ("Reference angle", r"$\tan\frac{\pi}{3} = \sqrt{3}$"),
                    ("Quadrants", "Tangent is positive in Quadrants I and III."),
                    ("Use the period", r"Tangent repeats every $\pi$: $\frac{\pi}{3} + \pi = \frac{4\pi}{3}$."),
                    ("Solutions", r"$\theta = \frac{\pi}{3}, \frac{4\pi}{3}$"),
                )),
        Problem("Wheelchair ramp — angle with the ground",
                "A wheelchair ramp is 24 ft long and rises 2 ft from the ground to a doorway. Find the angle "
                "the ramp makes with the ground, to the nearest tenth of a degree.",
                r"$\theta \approx 4.8^\circ$", "medium", (
                    ("Set up", r"The rise is opposite the angle and the ramp is the hypotenuse: "
                               r"$\sin\theta = \frac{2}{24}$."),
                    ("Inverse sine", r"$\theta = \sin^{-1}\left(\frac{1}{12}\right)$"),
                    ("Evaluate", r"$\theta \approx 4.78^\circ \approx 4.8^\circ$"),
                )),
    ),
)

HOMEWORKS = (HW_42, HW_44, HW_51)


# ── Shared grader language for the errors several students made ─────

def _quadrant_miss(step: int) -> Grade:
    return partial(
        20,
        "Isolated sin θ = −1/2 and found the π/6 reference angle, but placed it in Quadrants I and II, where "
        "sine is positive. sin θ is negative in Quadrants III and IV, giving 7π/6 and 11π/6; neither listed "
        "angle satisfies the equation.",
        "Your algebra and reference angle are right. Sine is negative here, so the angles belong in "
        "Quadrants III and IV.",
        ((65, "Quadrants — used QI/QII, where sine is positive; sin θ = −1/2 lies in QIII/QIV", step),
         (15, "Final answers π/6 and 5π/6 don't satisfy the equation", step)),
        confidence=0.93,
    )


def _missed_two_pi(step: int | None) -> Grade:
    return partial(
        70,
        "Maximum value 3 is correct, but cos x = 1 again at x = 2π, which is in the closed interval [0, 2π]; "
        "one location is missing.",
        "Right maximum! The interval includes 2π, where cosine is 1 again.",
        ((30, "Incomplete — missed x = 2π, also in [0, 2π]", step),),
        confidence=0.91,
    )


# ── What each student turned in ─────────────────────────────────────

TURN_INS: tuple[TurnIn, ...] = (
    # ── 4.2 ──
    TurnIn("fake_1", "4.2", 27.5, "published", 0.95, (
        Work((L(r"\frac{5\pi}{6} \to \text{QII}"), L(r"\text{ref } \frac{\pi}{6}"),
              B(r"\sin\frac{5\pi}{6} = \frac{1}{2}")), r"\frac{1}{2}",
             full("Reference angle π/6 in Quadrant II, where sine is positive — 1/2 is correct.",
                  "Nice — reference angle and quadrant sign both right.")),
        Work((L(r"\frac{4\pi}{3} \to \text{QIII}, \text{ ref } \frac{\pi}{3}"), L(r"\cos \text{ neg in QIII}"),
              B(r"\cos\frac{4\pi}{3} = -\frac{1}{2}")), r"-\frac{1}{2}",
             full("Quadrant III, reference angle π/3, cosine negative — −1/2 is correct.",
                  "Correct, with the sign reasoning shown.")),
        Work((L(r"\frac{7\pi}{4} \to \text{QIV}"), L(r"\tan\frac{\pi}{4} = 1"), B(r"\tan\frac{7\pi}{4} = -1")), "-1",
             full("Reference value tan(π/4) = 1 with the Quadrant IV sign gives −1.", "Correct.")),
        Work((L(r"\csc = \frac{1}{\sin}"), L(r"\sin\frac{7\pi}{6}: \text{ ref } \frac{\pi}{6}"),
              B(r"\csc\frac{7\pi}{6} = \frac{1}{1/2} = 2")), "2",
             partial(40, "Reciprocal identity and reference angle are right, but 7π/6 is in Quadrant III where sine "
                         "(and cosecant) are negative — sin(7π/6) = −1/2, so the answer is −2.",
                     "You set up the reciprocal correctly — check the quadrant: 7π/6 is in QIII, where sine is "
                     "negative.",
                     ((60, "Sign — took sin(7π/6) as +1/2; sine is negative in Quadrant III, so csc(7π/6) = −2", 3),)),
             ("conceptual_gap", "fake_1 used the reciprocal identity and the π/6 reference angle correctly but "
                                "took sin(7π/6) as +1/2. The quadrant of 7π/6 never reached the sign of sine — the "
                                "same Quadrant III sign question three classmates missed on this problem.")),
        Work((L(r"\sin 60^\circ = \frac{h}{20}"), L(r"h = 20\sin 60^\circ"),
              L(r"h = 20 \cdot \frac{\sqrt{3}}{2} = 10\sqrt{3}"), B(r"h \approx 17.3 \text{ ft}")),
             r"10\sqrt{3} \approx 17.3 \text{ ft}",
             full("Sine set up from opposite over hypotenuse; exact value 10√3 and 17.3 ft are both correct.",
                  "Clean setup and both forms of the answer — great.")),
    ), Check(5, "pass", "Explained the ladder setup and predicted correctly",
             "fake_1 explained why sine fits the ladder problem (height opposite the 60° angle, ladder as the "
             "hypotenuse) and correctly reasoned that a steeper ladder reaches higher. Understanding matches the "
             "written work.",
             rubric("high", "high", prediction="high"),
             "Explained choosing sine from the opposite side and hypotenuse in their own words, then predicted a "
             "steeper ladder reaches higher and tied it to sine growing toward 90°.",
             (A("Hi! Thanks for turning in 4.2. I'd like to ask about problem 5, the ladder. On your first line you "
                "wrote sin 60° = h/20. What made you use sine there instead of cosine?"),
              S("because h is across from the 60 angle and the ladder is the hypotenuse", 38),
              A("Exactly — opposite over hypotenuse. Quick one: if the ladder made a steeper angle with the ground, "
                "say 70°, would it reach higher or lower up the wall? Why?"),
              S("higher. sin gets bigger as the angle gets closer to 90 so 20sin70 is bigger", 45),
              A("That's right, and nicely explained. You're all set on this one — thanks!")))),

    TurnIn("fake_2", "4.2", 30.0, "published", 0.97, (
        Work((L(r"\text{ref} = \frac{\pi}{6}, \text{ QII}"), B(r"\sin\frac{5\pi}{6} = \frac{1}{2}")), r"\frac{1}{2}",
             full("Correct reference angle and Quadrant II sign.", "Correct.")),
        Work((L(r"\text{ref} = \frac{\pi}{3}, \text{ QIII}"), B(r"\cos\frac{4\pi}{3} = -\frac{1}{2}")),
             r"-\frac{1}{2}", full("Correct reference angle and Quadrant III sign.", "Correct.")),
        Work((L(r"\text{ref} = \frac{\pi}{4}, \text{ QIV}"), B(r"\tan\frac{7\pi}{4} = -1")), "-1",
             full("Correct: tangent is negative in Quadrant IV.", "Correct.")),
        Work((L(r"\sin\frac{7\pi}{6} = -\frac{1}{2}"), B(r"\csc\frac{7\pi}{6} = \frac{1}{-1/2} = -2")), "-2",
             full("Found sin(7π/6) = −1/2 and took the reciprocal: −2.", "Correct — nice reciprocal work.")),
        Work((L(r"\sin 60^\circ = \frac{h}{20}"), L(r"h = 20 \cdot \frac{\sqrt{3}}{2}"),
              L(r"h = 10\sqrt{3} \approx 17.32"), B(r"h \approx 17.3 \text{ ft}")),
             r"10\sqrt{3} \approx 17.3 \text{ ft}",
             full("Correct setup; exact and rounded answers both given with units.", "Excellent work.")),
    ), Check(5, "pass", "Clear grasp of sine as a ratio",
             "fake_2 tied √3/2 to the unit circle's y-value at 60° and correctly scaled the answer for a 30 ft "
             "ladder (15√3 ≈ 26 ft). Strong, independent explanation.",
             rubric("high", "high", transfer="high"),
             "Explained where √3/2 comes from (the unit-circle y-value at 60°) and transferred the setup to a "
             "30 ft ladder without prompting.",
             (A("Hi! Nice work on 4.2. Let's look at problem 5. You wrote h = 20 · √3/2. Where did the √3/2 "
                "come from?"),
              S("its sin 60. on the unit circle the y value at 60 degrees is root 3 over 2", 31),
              A("Right, the y-coordinate at 60° (π/3). If the ladder were 30 ft instead of 20 ft but the angle "
                "stayed 60°, what would happen to your answer?"),
              S("it would be 15 root 3 so like 26 ft. it just scales with the ladder", 40),
              A("Spot on — the height is proportional to the ladder's length. Great job, that's all I needed.")))),

    TurnIn("fake_3", "4.2", 6.0, "published", 0.94, (
        Work((L(r"\frac{5\pi}{6} \text{ is in QII}"), B(r"\sin\frac{5\pi}{6} = \frac{1}{2}")), r"\frac{1}{2}",
             full("Quadrant II, sine positive, 1/2 — correct.", "Correct.")),
        Work((L(r"\frac{4\pi}{3} \text{ QIII} \to \text{neg}"), B(r"\cos\frac{4\pi}{3} = -\frac{\sqrt{3}}{2}")),
             r"-\frac{\sqrt{3}}{2}",
             partial(50, "Quadrant and sign are right, but cos(π/3) is 1/2, not √3/2 — the sine and cosine values "
                         "for π/3 were swapped.",
                     "Good sign work. Double-check which coordinate is cosine at π/3 — it's the x-value, 1/2.",
                     ((50, "Value — used √3/2 (sin π/3) instead of 1/2 for cos π/3", 2),)),
             ("conceptual_gap", "fake_3 placed 4π/3 in Quadrant III and gave a negative answer, but used √3/2 "
                                "for the reference value. They may be mixing up which unit-circle coordinate is "
                                "cosine at π/3 (x = 1/2) and which is sine (y = √3/2).")),
        Work((L(r"\frac{7\pi}{4} \text{ ref} = \frac{\pi}{4}"), L(r"\tan\frac{\pi}{4} = 1"),
              B(r"\tan\frac{7\pi}{4} = 1")), "1",
             partial(50, "Reference angle π/4 and tan(π/4) = 1 are right, but 7π/4 is in Quadrant IV, where "
                         "tangent is negative; the answer is −1.",
                     "You found the reference value — now apply the QIV sign: tangent is negative there.",
                     ((50, "Sign — no Quadrant IV sign applied; tan(7π/4) = −1", 3),)),
             ("procedural_slip", "fake_3 found the π/4 reference angle and tan(π/4) = 1 but never applied the "
                                 "Quadrant IV sign. They did adjust the sign for Quadrant III on #2, so this is "
                                 "likely a skipped step rather than a gap.")),
        Work((L(r"\csc\theta = \frac{1}{\sin\theta}"), L(r"\sin\frac{7\pi}{6} = \frac{1}{2}"),
              B(r"\csc\frac{7\pi}{6} = 2")), "2",
             partial(40, "Reciprocal set up correctly, but sin(7π/6) is −1/2: 7π/6 is in Quadrant III, where sine is "
                         "negative. The answer is −2.",
                     "Good reciprocal — but 7π/6 is in Quadrant III, so sin(7π/6) is negative and so is csc.",
                     ((60, "Sign — sin(7π/6) taken as +1/2; in Quadrant III it is −1/2, so csc = −2", 2),)),
             ("conceptual_gap", "fake_3 wrote sin(7π/6) = 1/2 — the reference value with no Quadrant III sign — and "
                                "took its reciprocal correctly. With the tangent sign also missed on #3, they seem "
                                "to stop at the reference angle without asking which quadrant the angle is in.")),
        Work((L(r"\sin 60 = \frac{h}{20}"), L(r"h = 20\sin 60"), B(r"h = 10\sqrt{3} = 17.3")),
             r"10\sqrt{3} = 17.3",
             full("Correct setup with sine; exact 10√3 and 17.3 are both right (no units written).",
                  "Correct! Remember to label your answer with units (ft).", 0.92)),
    ), Check(5, "needs_practice", "Needed help connecting sine to the triangle",
             "fake_3's answer is correct, but they first chose sine because it's \"the first one\" in SOH-CAH-TOA "
             "and needed a narrowed prompt to identify the height as the opposite side. Worth a quick review of "
             "choosing the ratio from the diagram.",
             rubric("low", "mid"),
             "Justified sine as the first ratio in SOH-CAH-TOA and used the stuck button; with a narrowed question "
             "identified h as opposite the 60° angle. Correct work, but the reasoning needed scaffolding.",
             (A("Hi! Let's talk about problem 5. You started with sin 60 = h/20. How did you decide to use sine for "
                "this one?"),
              S("the teacher said soh cah toa and it was the first one", 22),
              A("SOH-CAH-TOA is a great tool! Let's use it on your picture: which side is h — opposite the 60° "
                "angle, next to it, or the hypotenuse?"),
              STUCK_TAP(12),
              A("No problem, let's narrow it down. The 60° angle is down at the ground where the ladder touches. "
                "Is the wall height h touching that corner, or across from it?"),
              S("across from it. so opposite", 28),
              A("Yes! Opposite over hypotenuse is SOH — that's exactly why sine works here. Nice job getting "
                "there.")))),

    TurnIn("fake_4", "4.2", 1.5, "published", 0.93, (
        Work((L(r"\sin\frac{5\pi}{6}"), L(r"\text{ref } \frac{\pi}{6}"), B(r"= \frac{1}{2}")), r"\frac{1}{2}",
             full("Reference angle π/6, Quadrant II — 1/2 is correct.", "Correct.")),
        Work((L(r"\cos\frac{4\pi}{3}"), L(r"\text{ref } \frac{\pi}{3}"), B(r"\cos\frac{\pi}{3} = \frac{1}{2}")),
             r"\frac{1}{2}",
             partial(50, "Reference angle π/3 and its cosine are right, but 4π/3 is in Quadrant III where cosine "
                         "is negative; the answer is −1/2.",
                     "Right reference value — but cosine is negative in Quadrant III.",
                     ((50, "Sign — cosine is negative in Quadrant III; cos(4π/3) = −1/2", 3),)),
             ("conceptual_gap", "fake_4 found the π/3 reference angle and its cosine but reported the reference "
                                "value as the answer. With a similar issue on #4, they may not yet connect the "
                                "quadrant of the angle to the sign of the result.")),
        Work((L(r"\frac{7\pi}{4} \text{ QIV}"), L(r"\tan \text{ neg in QIV}"), B(r"\tan\frac{7\pi}{4} = -1")), "-1",
             full("Quadrant IV, tangent negative — −1 is correct.", "Correct.")),
        Work((L(r"\csc\frac{7\pi}{6}"), L(r"\sin\frac{7\pi}{6} = \frac{1}{2}"), B(r"\csc\frac{7\pi}{6} = 2")),
             "2",
             partial(40, "Took the reciprocal correctly, but sin(7π/6) is −1/2, not 1/2 — 7π/6 is in Quadrant III, "
                         "where sine is negative. The answer is −2.",
                     "The reciprocal step is right. 7π/6 is in Quadrant III, so sine — and cosecant — are negative.",
                     ((60, "Sign — sine is negative in Quadrant III; sin(7π/6) = −1/2, so csc = −2", 2),)),
             ("conceptual_gap", "fake_4 took sin(7π/6) as +1/2 and its reciprocal as 2. Together with the cosine "
                                "sign missed on #2, the quadrant of the angle isn't yet deciding the sign of the "
                                "answer.")),
        Work((L(r"\cos 60^\circ = \frac{h}{20}"), L(r"h = 20\cos 60^\circ"), B(r"h = 20 \cdot \frac{1}{2} = 10")),
             "10",
             partial(50, "Used cosine, which gives the distance along the ground (adjacent side), not the height; "
                         "the height is opposite the 60° angle, so h = 20 sin 60° = 10√3 ≈ 17.3 ft. Arithmetic for "
                         "the chosen ratio is correct.",
                     "Your arithmetic is clean — but the height is opposite the 60° angle, so use sine.",
                     ((50, "Ratio — used cosine (adjacent) for the height, which is opposite the 60° angle", 1),)),
             ("conceptual_gap", "fake_4 set up cos 60° = h/20, treating the wall height as the side next to the "
                                "60° ground angle. The arithmetic is right for that setup, so the gap is in "
                                "matching the side to the ratio, not in the computation.")),
    ), Check(3, "needs_practice", "Knows the mnemonic, shaky on the why",
             "fake_4 got tan(7π/4) = −1 using \"All Students Take Calculus\", but couldn't explain the sign until "
             "reminded that tangent is y/x. The sign errors on #2 and #4 suggest quadrant signs need practice.",
             rubric("mid", "low", self_correction="mid"),
             "Recalled the ASTC mnemonic but couldn't say why tangent is negative in Quadrant IV until prompted "
             "with tan = y/x; then reasoned negative over positive.",
             (A("Hi! Let's look at problem 3. You wrote \"tan neg in QIV\". How do you know tangent is negative "
                "there?"),
              S("bc of all students take calculus", 19),
              A("Nice, that's a handy memory trick! What does it tell you about Quadrant IV — which function is "
                "positive there, and why does that make tangent negative?"),
              S("cos is positive i think. idk why tan is neg tho", 35, "honest_confusion"),
              A("Good — cosine is positive in QIV. In Quadrant IV, x is positive and y is negative, and tangent "
                "is y over x. So what sign do you get?"),
              S("neg over pos so negative", 14),
              A("Exactly — that's the reason behind the trick. Thanks for working through it with me!")))),

    TurnIn("fake_5", "4.2", 26.0, "published", 0.96, (
        Work((L(r"\text{QII, ref} = \frac{\pi}{6}"), B(r"\sin\frac{5\pi}{6} = \frac{1}{2}")), r"\frac{1}{2}",
             full("Correct quadrant, reference angle and value.", "Correct.")),
        Work((L(r"\text{QIII, ref} = \frac{\pi}{3}"), B(r"\cos\frac{4\pi}{3} = -\frac{1}{2}")), r"-\frac{1}{2}",
             full("Correct quadrant, reference angle and sign.", "Correct.")),
        Work((L(r"\text{QIV, ref} = \frac{\pi}{4}"), L(r"\tan\frac{7\pi}{4} = \frac{-\sqrt{2}/2}{\sqrt{2}/2}"),
              B(r"= -1")), "-1",
             full("Evaluated tangent as y/x of the unit-circle point: −1.", "Correct — nice use of the coordinates.")),
        Work((L(r"\sin\frac{7\pi}{6} = -\frac{1}{2}"), L(r"\csc\frac{7\pi}{6} = \frac{1}{-1/2}"),
              B(r"= -\frac{1}{2}")), r"-\frac{1}{2}",
             partial(50, "Set up csc = 1/sin with sin(7π/6) = −1/2 correctly, but 1 ÷ (−1/2) is −2, not −1/2.",
                     "Great setup — recheck the division: 1 divided by −1/2 is −2.",
                     ((50, "Arithmetic — 1/(−1/2) evaluated as −1/2 instead of −2", 3),)),
             ("procedural_slip", "fake_5 set up csc(7π/6) = 1/(−1/2) correctly and then simplified it to −1/2. The "
                                 "reciprocal idea is there; dividing by a fraction is the slip.")),
        Work((L(r"\sin 60^\circ = \frac{h}{20}"), L(r"h = 20 \cdot \frac{\sqrt{3}}{2}"),
              B(r"h = 10\sqrt{3} \text{ ft}")), r"10\sqrt{3} \text{ ft}",
             partial(75, "Correct setup and exact answer 10√3 ft, but the decimal to the nearest tenth (≈ 17.3 ft) "
                         "that the problem asks for is missing.",
                     "Exact answer is right — the problem also asked for a decimal: about 17.3 ft.",
                     ((25, "Incomplete — decimal approximation (≈ 17.3 ft) not given", None),)),
             ("procedural_slip", "fake_5 set up sin 60° = h/20 and simplified to the exact 10√3 ft correctly, "
                                 "but stopped before the decimal the problem asked for. The trig is sound; the "
                                 "second part of the question was skipped.")),
    ), Check(3, "pass", "Explained tangent from unit circle coordinates",
             "fake_5 explained tan(7π/4) as y/x of the unit-circle point and correctly predicted tan(3π/4) = −1 "
             "from the signs in Quadrant II. Solid understanding.",
             rubric("high", "high", transfer="high"),
             "Derived the fraction from the unit-circle point (√2/2, −√2/2) and transferred the sign reasoning to "
             "3π/4 correctly.",
             (A("Hi! Let's chat about problem 3. You wrote tan(7π/4) as (−√2/2) over (√2/2). Where did those two "
                "numbers come from?"),
              S("the point on the unit circle at 7pi/4 is (root2/2, -root2/2) and tan is y over x", 41),
              A("Great. Suppose the angle were 3π/4 instead. Without redoing everything, what would tan be, and "
                "why?"),
              S("also -1. its in QII so x is negative and y is positive, still neg over pos", 37),
              A("Exactly right. You clearly know where those values come from — that's all for today!")))),

    # ── 4.4 ──
    TurnIn("fake_1", "4.4", 8.0, "published", 0.95, (
        Work((L("A = 3"), B(r"T = \frac{2\pi}{2} = \pi")), r"A = 3,\ T = \pi",
             full("Amplitude 3 and period 2π/2 = π are correct.", "Correct.")),
        Work((L("A = -2"), L(r"T = \frac{2\pi}{1/2} = 4\pi"), B(r"\text{midline } y = 1")),
             r"A = -2,\ T = 4\pi,\ y = 1",
             partial(70, "Period 4π and midline y = 1 are correct; amplitude is a distance, so it's |−2| = 2, "
                         "not −2.",
                     "Period and midline are right. Amplitude is always positive — the negative just flips the "
                     "graph.",
                     ((30, "Amplitude — reported −2; amplitude is |A| = 2", 1),)),
             ("conceptual_gap", "fake_1 wrote the amplitude as −2, carrying the coefficient's sign. Period and "
                                "midline were handled correctly, so the gap is specific to amplitude being a "
                                "distance (|A|), not a signed value.")),
        Work((L(r"\cos x \text{ max} = 1"), L("y = 4(1) - 1 = 3"), B(r"\text{max} = 3 \text{ at } x = 0")),
             r"3 \text{ at } x = 0", _missed_two_pi(3),
             ("procedural_slip", "fake_1 found the maximum value 3 and x = 0 but didn't check the right endpoint "
                                 "of the closed interval [0, 2π], where cos x = 1 again.")),
        Work((L(r"\text{max when } \cos = -1"), L(r"h = 25 + 20 = 45 \text{ ft}"),
              B(r"T = \frac{2\pi}{\pi/15} = 30 \text{ sec}")), r"45 \text{ ft},\ 30 \text{ sec}",
             full("Maximum 45 ft from cos = −1 and period 2π ÷ (π/15) = 30 s are correct.",
                  "Both parts right, with units.")),
    ), Check(4, "pass", "Reasoned through the Ferris wheel clearly",
             "fake_1 explained why the maximum height comes from cos = −1 (because of the minus sign) and "
             "correctly predicted a 20-second revolution for B = π/10. Understanding matches the work.",
             rubric("high", "high", prediction="high"),
             "Explained the role of the minus sign in finding the maximum and predicted the new period for a "
             "different B correctly.",
             (A("Hi! Let's look at problem 4, the Ferris wheel. You wrote the max happens when cos = −1. Why −1 "
                "and not 1?"),
              S("because its minus 20cos. so if cos is -1 it turns into plus 20 and thats the biggest", 44),
              A("Exactly. Now imagine the formula were h(t) = 25 − 20cos(π/10 · t). Would one revolution take "
                "more time or less time than 30 seconds?"),
              S("less. 2pi divided by pi/10 is 20 so 20 sec", 36),
              A("Right — a bigger B means a faster wheel. Nice reasoning, thanks!")))),

    TurnIn("fake_2", "4.4", 28.0, "published", 0.97, (
        Work((L(r"\text{amp} = 3"), B(r"\text{period} = \frac{2\pi}{2} = \pi")), r"\text{amp } 3,\ \text{period } \pi",
             full("Amplitude 3 and period π are correct.", "Correct.")),
        Work((L(r"\text{amp} = |-2| = 2"), L(r"\text{period} = 4\pi"), B(r"\text{midline: } y = 1")),
             r"2,\ 4\pi,\ y = 1", full("All three parts correct.", "Correct — nice use of |−2|.")),
        Work((L(r"\cos x = 1 \Rightarrow y = 3"), B("x = 0")), r"\max 3,\ x = 0", _missed_two_pi(2),
             ("procedural_slip", "fake_2 found the correct maximum and x = 0 but stopped at the first solution. "
                                 "Everything else on the page is precise, so this looks like not checking the "
                                 "endpoint 2π rather than a gap.")),
        Work((L(r"\text{max when } \cos = -1"), L(r"h = 25 + 20 = 45 \text{ ft}"),
              B(r"\text{period} = \frac{2\pi}{\pi/15} = 30 \text{ s}")), r"45 \text{ ft},\ 30 \text{ s}",
             full("Both the 45 ft maximum and the 30 s revolution are correct.", "Excellent.")),
    ), Check(4, "pass", "Connected the model to the real wheel",
             "fake_2 interpreted the 30-second period as one full revolution and correctly reasoned that a larger "
             "wheel changes the amplitude and midline but not the period.",
             rubric("high", "high", transfer="high"),
             "Interpreted the period physically and transferred the model to a larger wheel, separating which "
             "parameters change.",
             (A("Hi! Quick questions about problem 4. You found the period with 2π ÷ (π/15). What does that 30 "
                "actually mean for the rider?"),
              S("its how long one full spin takes, 30 seconds to get back to where you started", 29),
              A("Right. If the wheel's radius were bigger but it still turned at the same speed, which numbers in "
                "h(t) would change?"),
              S("the 20 gets bigger and probably the 25 too since the center is higher. the pi/15 stays the same",
                52),
              A("Great thinking — amplitude and midline change, the period doesn't. That's all, thanks!")))),

    TurnIn("fake_3", "4.4", 9.0, "published", 0.94, (
        Work((L("A = 3"), B(r"T = 2\pi \cdot 2 = 4\pi")), r"A = 3,\ T = 4\pi",
             partial(50, "Amplitude 3 is correct, but the period is 2π/B = 2π/2 = π; the work multiplied by 2 "
                         "instead of dividing.",
                     "Amplitude is right. For period, divide 2π by B: 2π/2 = π.",
                     ((50, "Period — multiplied 2π by B instead of dividing; period is π", 2),)),
             ("procedural_slip", "fake_3 multiplied 2π by 2 for the period of sin(2x). On #2 they correctly divided "
                                 "2π by 1/2 to get 4π, so the rule is known; this looks like a slip in which "
                                 "operation to use.")),
        Work((L("A = 2"), L(r"T = \frac{2\pi}{1/2} = 4\pi"), B(r"\text{midline } y = 1")),
             r"A = 2,\ T = 4\pi,\ y = 1", full("All three parts correct.", "Correct.")),
        Work((L(r"\cos x = 1 \text{ at } 0, 2\pi"), L("y = 4 - 1 = 3"),
              B(r"\max 3 \text{ at } x = 0, 2\pi")), r"3 \text{ at } x = 0, 2\pi",
             full("Maximum 3 at both x = 0 and x = 2π — correct and complete.", "Correct — you caught both.")),
        Work((L(r"\max = 25 + 20 = 45"), L(r"\frac{\pi}{15}t \to 15"), B(r"T = 15 \text{ sec}")),
             r"45,\ 15 \text{ sec}",
             partial(50, "Maximum height 45 is right (no units written); the period is 2π ÷ (π/15) = 30 s — the "
                         "work read 15 off the coefficient instead of computing it.",
                     "Max height is right. For the time of one turn, divide 2π by π/15.",
                     ((50, "Period — took 15 from the coefficient; T = 2π/(π/15) = 30 s", 2),)),
             ("conceptual_gap", "fake_3 found the 45 maximum but took the period straight from the 15 in π/15. "
                                "They may not see that the period comes from 2π ÷ B when B contains π.")),
    ), Check(2, "pass", "Explained the period stretch in own words",
             "fake_3 explained that dividing 2π by 1/2 doubles the period to 4π and correctly reasoned the graph "
             "completes fewer cycles than cos x. The period slip on #1 looks careless rather than a gap.",
             rubric("high", "mid", prediction="high"),
             "Explained dividing by 1/2 as doubling the period, then predicted fewer cycles than cos x over the "
             "same interval.",
             (A("Hi! Let's talk about problem 2. You got a period of 4π. Can you explain how the x/2 inside the "
                "cosine gives you 4π?"),
              S("you do 2pi divided by the number in front of x which is 1/2. dividing by a half doubles it so 4pi",
                48),
              A("Nice. Between 0 and 4π, does y = −2cos(x/2) + 1 complete more cycles or fewer cycles than plain "
                "cos x?"),
              S("fewer. it only does 1 whole cycle by 4pi, regular cos would do 2", 39),
              A("Exactly right — a stretched period means fewer cycles. Thanks, that's everything!")))),

    TurnIn("fake_4", "4.4", -13.0, "published", 0.92, (
        Work((L("A = 3"), B(r"\text{period} = \frac{2\pi}{2} = \pi")), r"A = 3,\ \text{period } \pi",
             full("Amplitude 3 and period π are correct.", "Correct.")),
        Work((L("A = -2"), L(r"\text{period} = 2\pi \cdot \frac{1}{2} = \pi"), B("y = 1")),
             r"A = -2,\ \text{period } \pi,\ y = 1",
             partial(36, "Midline y = 1 is correct. Amplitude should be |−2| = 2, and the period is 2π ÷ (1/2) = 4π "
                         "— the work multiplied by 1/2.",
                     "Midline is right. Amplitude is never negative, and for the period divide 2π by 1/2.",
                     ((30, "Amplitude — reported −2; amplitude is 2", 1),
                      (34, "Period — multiplied by 1/2 instead of dividing; period is 4π", 2))),
             ("conceptual_gap", "fake_4 kept the negative sign as the amplitude and multiplied 2π by 1/2 for the "
                                "period. Both errors suggest the definitions (amplitude = |A|, period = 2π/B) "
                                "aren't solid yet.")),
        Work((L(r"\max \cos = 1"), L(r"y = 4\cos x - 1"), B(r"\max = 4 \text{ at } x = 0")),
             r"4 \text{ at } x = 0",
             partial(30, "Used cos x = 1 at x = 0 but didn't subtract the 1: the maximum is 4(1) − 1 = 3, and it "
                         "also occurs at x = 2π.",
                     "Good start with cos x = 1 — don't forget the −1 shift, and check x = 2π too.",
                     ((50, "Value — dropped the −1 shift; the maximum is 3", 3),
                      (20, "Incomplete — missed x = 2π", None))),
             ("procedural_slip", "fake_4 correctly used cos x = 1 for the maximum but reported 4 instead of "
                                 "4 − 1 = 3, and listed only x = 0. The vertical shift was dropped in the last "
                                 "step.")),
        Work((L(r"\max: 25 + 20 = 45"), B(r"T = 2\pi")), r"45,\ 2\pi",
             partial(60, "Maximum height 45 is correct (no units). The revolution time is 2π ÷ (π/15) = 30 s; 2π is "
                         "the period of plain cosine, not this function.",
                     "Max height is right. The π/15 changes the period: 2π ÷ (π/15) = 30 seconds.",
                     ((40, "Period — used 2π, ignoring B = π/15; T = 30 s", 2),)),
             ("conceptual_gap", "fake_4 used 2π as the revolution time — the period of cos t — without accounting "
                                "for the π/15 inside. Together with #2 this points to the period formula 2π/B.")),
    ), Check(1, "needs_practice", "Formula recalled, idea needed a nudge",
             "fake_4 applied 2π/B correctly but could only cite the formula; after a worked prompt (x = π gives "
             "2x = 2π) they saw the graph is squeezed. The errors on #2–#4 also involve the period.",
             rubric("low", "mid", self_correction="mid"),
             "Cited the formula without meaning; used the stuck button on what the 2 does, then reasoned from "
             "x = π that the cycle finishes early.",
             (A("Hi! Let's look at problem 1. You wrote period = 2π/2 = π. Why do we divide by 2 there?"),
              S("bc the formula is 2pi over b", 17),
              A("That's the formula, yes! What does the 2 in sin(2x) do to the graph itself — stretch it out or "
                "squeeze it together?"),
              STUCK_TAP(9),
              A("That's okay — let's try numbers. sin x finishes one cycle at x = 2π. When x = π, what is 2x?"),
              S("2pi. oh so it finishes the cycle at pi already, its squished", 33),
              A("Exactly — the 2 squeezes the graph so it repeats twice as fast. That's why the period is π. Good "
                "work getting there.")))),

    TurnIn("fake_5", "4.4", 25.0, "published", 0.95, (
        Work((L(r"\text{amp } 3"), B(r"\text{per} = \frac{2\pi}{2} = \pi")), r"\text{amp } 3,\ \text{per } \pi",
             full("Amplitude 3 and period π are correct.", "Correct.")),
        Work((L(r"\text{amp} = 2"), L(r"\text{per} = \frac{2\pi}{0.5} = 4\pi"), B(r"\text{midline } y = 1")),
             r"2,\ 4\pi,\ y = 1", full("All three parts correct.", "Correct.")),
        Work((L(r"\cos x = 1 \to x = 0"), B("y = 4 - 1 = 3")), r"3 \text{ at } x = 0", _missed_two_pi(1),
             ("procedural_slip", "fake_5 got the maximum value 3 from cos x = 1 at x = 0 but missed x = 2π at the "
                                 "end of the closed interval.")),
        Work((L(r"h = 25 + 20 = 45 \text{ ft}"), B(r"\text{one rev} = 2\pi \text{ s}")),
             r"45 \text{ ft},\ 2\pi \text{ s}",
             partial(50, "Maximum height 45 ft is correct; one revolution is 2π ÷ (π/15) = 30 s, not 2π s.",
                     "Max height is right. The period here is 2π ÷ (π/15) = 30 seconds.",
                     ((50, "Period — gave 2π s; T = 2π/(π/15) = 30 s", 2),)),
             ("conceptual_gap", "fake_5 found the 45 ft maximum but gave 2π seconds for one revolution, the period "
                                "of cos t. They computed 2π/B correctly on #1 and #2, so they may not recognize "
                                "π/15 as B when it sits next to t.")),
    ), Check(2, "pass", "Clear on amplitude and midline",
             "fake_5 explained why amplitude ignores the negative sign (it's a distance from the midline; the sign "
             "flips the graph) and correctly predicted only the midline changes with a +3 shift.",
             rubric("high", "high", transfer="high"),
             "Explained amplitude as a distance and the sign as a reflection; transferred correctly to a changed "
             "vertical shift.",
             (A("Hi! Let's chat about problem 2. You wrote amp = 2 even though there's a −2 in front. Why not −2?"),
              S("amplitude is like the height from the middle so it cant be negative. the minus just flips it "
                "upside down", 46),
              A("Perfect. If we changed the +1 at the end to +3, which of your three answers would change?"),
              S("just the midline, it would be y=3", 21),
              A("Exactly. Nice clear thinking — that's all for this one!")))),

    # ── 5.1 ──
    TurnIn("fake_1", "5.1", 77.5, "to_review", 0.95, (
        Work((L(r"2\cos\theta = 1"), L(r"\cos\theta = \frac{1}{2}"), B(r"\theta = \frac{\pi}{3}, \frac{5\pi}{3}")),
             r"\frac{\pi}{3}, \frac{5\pi}{3}",
             full("Both solutions in Quadrants I and IV, where cosine is positive — correct.", "Correct.")),
        Work((L(r"2\sin\theta = -1"), L(r"\sin\theta = -\frac{1}{2}"), L(r"\text{ref} = \frac{\pi}{6}"),
              B(r"\theta = \frac{\pi}{6}, \frac{5\pi}{6}")), r"\frac{\pi}{6}, \frac{5\pi}{6}", _quadrant_miss(4),
             ("conceptual_gap", "fake_1 isolated sin θ = −1/2 and found the π/6 reference angle, then placed it in "
                                "Quadrants I and II — where sine is positive. They appear to choose quadrants from "
                                "the reference angle alone rather than from the sign of the right-hand side.")),
        Work((L(r"\tan\theta = \sqrt{3}"), B(r"\theta = \frac{\pi}{3}")), r"\frac{\pi}{3}",
             partial(50, "π/3 is correct, but tangent is also positive in Quadrant III; 4π/3 is missing from "
                         "[0, 2π).",
                     "Good — now find the second one: tangent repeats every π, so π/3 + π = 4π/3.",
                     ((50, "Incomplete — missed θ = 4π/3 in Quadrant III", 2),)),
             ("procedural_slip", "fake_1 found θ = π/3 but stopped at one solution. They found both solutions on #1, "
                                 "so this looks like not checking the second quadrant rather than not knowing "
                                 "tangent's period.")),
        Work((L(r"\sin\theta = \frac{2}{24}"), L(r"\theta = \sin^{-1}(0.0833)"), B(r"\theta \approx 4.8^\circ")),
             r"4.8^\circ", full("Sine from opposite over hypotenuse, inverse sine evaluated to 4.8°.", "Correct.")),
    ), Check(4, "needs_practice", "Got there with step-by-step prompts",
             "fake_1's ramp answer is right, but they couldn't start the explanation and needed two narrowed "
             "questions to identify the opposite side and the hypotenuse. Separately, #2 places sin θ = −1/2 in "
             "Quadrants I and II.",
             rubric("low", "mid"),
             "Used the stuck button immediately; with narrowed questions identified the rise as opposite and the "
             "ramp as the hypotenuse, then connected that to sine. Correct work, explanation needed heavy "
             "scaffolding.",
             (A("Hi! Let's talk about problem 4, the ramp. You started with sin θ = 2/24. What made you choose sine "
                "for this one?"),
              STUCK_TAP(15),
              A("No worries — let's go one piece at a time. In your picture, is the 2 ft rise next to the angle at "
                "the ground, or across from it?"),
              S("across from it", 11),
              A("Right, it's opposite the angle. And the 24 ft ramp itself — which side of the triangle is that?"),
              S("the long one.. hypotenuse. so opp over hyp is sin", 27),
              A("Exactly — opposite over hypotenuse is sine, so your setup was right. Thanks for sticking with "
                "it!")))),

    TurnIn("fake_2", "5.1", 100.0, "to_review", 0.97, (
        Work((L(r"\cos\theta = \frac{1}{2}"), B(r"\theta = \frac{\pi}{3}, \frac{5\pi}{3}")),
             r"\frac{\pi}{3}, \frac{5\pi}{3}", full("Both solutions correct.", "Correct.")),
        Work((L(r"\sin\theta = -\frac{1}{2}"), L(r"\text{QIII, QIV}"), B(r"\theta = \frac{7\pi}{6}, \frac{11\pi}{6}")),
             r"\frac{7\pi}{6}, \frac{11\pi}{6}",
             full("Both solutions in Quadrants III and IV — correct.", "Correct.", 0.97)),
        Work((L(r"\tan\theta = \sqrt{3}"), B(r"\theta = \frac{\pi}{3}, \frac{4\pi}{3}")),
             r"\frac{\pi}{3}, \frac{4\pi}{3}",
             full("Both solutions correct.", "Correct.")),
        Work((L(r"\sin\theta = \frac{2}{24}"), L(r"\theta = \sin^{-1}\left(\frac{1}{12}\right)"),
              B(r"\theta \approx 4.8^\circ")), r"4.8^\circ", full("Correct setup and value.", "Correct.")),
    ), Check(2, "flag_for_review", "Couldn't explain the quadrant step on their page",
             "fake_2's answers are all correct, but they couldn't say why their page reads \"QIII, QIV\" — \"i "
             "just remember its those ones\" — and used the stuck button when asked whether sin θ = −1/2 is above "
             "or below the x-axis. Once the idea was explained they applied it to sin θ = +1/2 correctly. The "
             "written work is more fluent than the explanation; worth a quick conversation about how they "
             "solved it.",
             rubric("low", "low", transfer="mid"),
             "Couldn't give any reason for the QIII/QIV line on their own page and couldn't place sin θ = −1/2 "
             "above or below the x-axis unprompted. After sine was explained as the unit-circle y-coordinate, they "
             "chose Quadrants I and II for sin θ = +1/2 with the right angles — the idea landed only once it was "
             "given to them.",
             (A("Hi! Your 5.1 looks great. On problem 2 you wrote \"QIII, QIV\" under sin θ = −1/2. What does "
                "that line mean?"),
              S("its the quadrants the answers are in", 21),
              A("Right, those are quadrants. What about sin θ = −1/2 tells you the answers are in III and IV, and "
                "not I and II?"),
              S("i just remember its those ones for this", 26),
              A("Let's narrow it down. On the unit circle, sin θ is the y-coordinate of the point. Is a "
                "y-coordinate of −1/2 above or below the x-axis?"),
              STUCK_TAP(17),
              A("No problem — here's the idea. The point at angle θ is (cos θ, sin θ), so sin θ is how high the "
                "point sits. A negative sine means the point is below the x-axis, and the two quadrants below the "
                "x-axis are III and IV. That's where both of your answers live. Try it the other way: if the "
                "equation were sin θ = +1/2, which quadrants would the answers be in?"),
              S("above the axis so 1 and 2? so pi/6 and 5pi/6", 34),
              A("Exactly — positive sine is above the axis, so Quadrants I and II. That's the same reasoning behind "
                "your QIII, QIV line. Thanks for working through it with me!")))),

    TurnIn("fake_3", "5.1", 98.0, "approved", 0.94, (
        Work((L(r"2\cos\theta = 1"), L(r"\cos\theta = \frac{1}{2}"), B(r"\theta = \frac{\pi}{3}, \frac{5\pi}{3}")),
             r"\frac{\pi}{3}, \frac{5\pi}{3}", full("Both solutions correct.", "Correct.")),
        Work((L(r"\sin\theta = -\frac{1}{2}"), L(r"\text{ref} = \frac{\pi}{6}"),
              B(r"\theta = \frac{\pi}{6}, \frac{5\pi}{6}")), r"\frac{\pi}{6}, \frac{5\pi}{6}", _quadrant_miss(3),
             ("conceptual_gap", "fake_3 found sin θ = −1/2 and the π/6 reference angle, then gave the Quadrant I and "
                                "II angles. They seem to place the reference angle where sine is positive regardless "
                                "of the negative sign in the equation.")),
        Work((L(r"\tan\theta = \sqrt{3}"), L(r"\text{ref} = \frac{\pi}{3}, \text{ tan pos in QI, QIII}"),
              B(r"\theta = \frac{\pi}{3}, \frac{4\pi}{3}")), r"\frac{\pi}{3}, \frac{4\pi}{3}",
             full("Both solutions, with the Quadrant I/III reasoning shown.", "Correct — nice reasoning.")),
        Work((L(r"\sin\theta = \frac{2}{24}"), L(r"\theta = \sin^{-1}(0.083)"), B(r"\theta = 4.8")), "4.8",
             full("Correct setup with inverse sine; 4.8 is right to the nearest tenth (degree sign not written).",
                  "Correct! Include the degree sign: 4.8°.", 0.93)),
    ), Check(3, "pass", "Explained why tangent repeats every π",
             "fake_3 explained the second solution 4π/3 by adding π and justified it: at the opposite point both "
             "coordinates flip sign, so y/x is unchanged. Strong understanding of #3; #2 still places "
             "sin θ = −1/2 in Quadrants I and II.",
             rubric("high", "high", transfer="mid"),
             "Explained adding π and justified tangent's period from both coordinates flipping sign at the "
             "opposite point.",
             (A("Hi! Let's look at problem 3. You got π/3 and 4π/3. How did you find the second one?"),
              S("tan is positive in Q1 and Q3 so i added pi to pi/3", 34),
              A("Nice. Why does adding π land you on another solution for tangent?"),
              S("because tan repeats every pi not 2pi. the point is on the opposite side so sin and cos both flip "
                "and it cancels", 51),
              A("That's a great explanation — both coordinates flip sign, so y/x stays the same. You're all "
                "set!")))),

    TurnIn("fake_4", "5.1", 76.0, "to_review", 0.92, (
        Work((L(r"\cos\theta = \frac{1}{2}"), B(r"\theta = \frac{\pi}{3}")), r"\frac{\pi}{3}",
             partial(50, "π/3 is correct; cosine is also positive in Quadrant IV, so 5π/3 is missing.",
                     "Good — cosine is positive in Quadrant IV too, so there's a second answer: 5π/3.",
                     ((50, "Incomplete — missed θ = 5π/3 in Quadrant IV", 2),)),
             ("procedural_slip", "fake_4 solved cos θ = 1/2 for θ = π/3 but gave only one solution. They may be "
                                 "stopping at the reference angle without looking for the second quadrant.")),
        Work((L(r"\sin\theta = -\frac{1}{2}"), B(r"\theta = \frac{\pi}{6}, \frac{5\pi}{6}")),
             r"\frac{\pi}{6}, \frac{5\pi}{6}", _quadrant_miss(2),
             ("conceptual_gap", "fake_4 reached sin θ = −1/2 and answered with π/6 and 5π/6, the Quadrant I and II "
                                "angles where sine is positive. The negative sign doesn't seem to be informing "
                                "which quadrants they use.")),
        Work((L(r"\tan\theta = \sqrt{3}"), B(r"\theta = \frac{\pi}{3}, \frac{4\pi}{3}")),
             r"\frac{\pi}{3}, \frac{4\pi}{3}",
             full("Both solutions correct.", "Correct.")),
        Work((L(r"\cos\theta = \frac{2}{24}"), L(r"\theta = \cos^{-1}(0.083)"), B(r"\theta = 85.2^\circ")),
             r"85.2^\circ",
             partial(40, "Used cosine with the rise (2 ft), which is opposite the ground angle; sin θ = 2/24 gives "
                         "about 4.8°. 85.2° is the angle at the top of the ramp.",
                     "Your inverse-trig work is right — but the 2 ft rise is opposite the angle, so use sine.",
                     ((60, "Ratio — used cosine with the opposite side; θ ≈ 4.8°", 1),)),
             ("conceptual_gap", "fake_4 set up cos θ = 2/24 with the rise, which is opposite the ground angle, and "
                                "got 85.2° — the complementary angle at the top of the ramp. The inverse cosine "
                                "step itself was done correctly.")),
    ), Check(3, "needs_practice", "Needed prompts to explain the second solution",
             "fake_4 has both solutions to #3 but couldn't explain how they found 4π/3 until asked which quadrants "
             "tangent is positive in; then reasoned \"halfway around, plus π.\" #1, #2 and #4 show missing "
             "second solutions and a sine/cosine mix-up.",
             rubric("low", "mid"),
             "Used the stuck button; after narrowing to which quadrants tangent is positive in, reasoned that the "
             "Quadrant III angle is π further around.",
             (A("Hi! Let's talk about problem 3. You got π/3 and 4π/3. How did you get from π/3 to 4π/3?"),
              STUCK_TAP(8),
              A("That's okay. Let's start smaller: in which quadrants is tangent positive?"),
              S("1 and 3", 10),
              A("Yes! So you need the angle in Quadrant III with the same reference angle, π/3. How far around "
                "the circle is that from π/3?"),
              S("half way so plus pi? thats 4pi/3", 31),
              A("Exactly — adding π gets you to the matching Quadrant III angle. Nice work thinking it "
                "through.")))),
)


# ── An adopted student ───────────────────────────────────────────────
# `--adopt-student` gives a real student, already enrolled in Period 2,
# this history on 4.2 and 4.4 so the class reads complete with them in
# it. They miss 4.2 #4 the same quadrant way (4 of 6 under half, still
# flagged) and miss the 2π endpoint on 4.4 #3. 5.1 is left for them to
# do live.


def adopted_turn_ins(name: str) -> tuple[TurnIn, ...]:
    return (
        TurnIn("adopted", "4.2", 22.0, "published", 0.95, (
            Work((L(r"\frac{5\pi}{6} \text{ in QII, ref } \frac{\pi}{6}"), B(r"\sin\frac{5\pi}{6} = \frac{1}{2}")),
                 r"\frac{1}{2}", full("Quadrant II, reference angle π/6, sine positive — 1/2 is correct.",
                                      "Correct, with the quadrant shown.")),
            Work((L(r"\frac{4\pi}{3} \text{ in QIII, ref } \frac{\pi}{3}"), B(r"\cos\frac{4\pi}{3} = -\frac{1}{2}")),
                 r"-\frac{1}{2}", full("Quadrant III, reference angle π/3, cosine negative — −1/2 is correct.",
                                       "Correct.")),
            Work((L(r"\text{ref } \frac{\pi}{4}, \text{ QIV}"), B(r"\tan\frac{7\pi}{4} = -1")), "-1",
                 full("Tangent is negative in Quadrant IV; −1 is correct.", "Correct.")),
            Work((L(r"\csc\theta = \frac{1}{\sin\theta}"),
                  L(r"\text{ref } \frac{\pi}{6} \Rightarrow \sin = \frac{1}{2}"),
                  B(r"\csc\frac{7\pi}{6} = 2")), "2",
                 partial(40, "Reciprocal and π/6 reference angle are right, but 7π/6 is in Quadrant III, where sine is "
                             "negative: sin(7π/6) = −1/2, so the answer is −2.",
                         "Good reciprocal setup — 7π/6 is in Quadrant III, so sine and cosecant are negative.",
                         ((60, "Sign — sine is negative in Quadrant III; sin(7π/6) = −1/2, so csc = −2", 2),)),
                 ("conceptual_gap", f"{name} took the π/6 reference value straight to sin(7π/6) = 1/2 without "
                                    "applying the Quadrant III sign, though they marked quadrants on #1–#3 — the "
                                    "same sign step most of the class missed on this problem.")),
            Work((L(r"\sin 60^\circ = \frac{h}{20}"), L(r"h = 20 \cdot \frac{\sqrt{3}}{2} = 10\sqrt{3}"),
                  B(r"h \approx 17.3 \text{ ft}")), r"10\sqrt{3} \approx 17.3 \text{ ft}",
                 full("Sine from opposite over hypotenuse; 10√3 ≈ 17.3 ft is correct.", "Nice, both forms given.")),
        ), Check(5, "pass", "Explained the ladder setup in their own words",
                 f"{name} explained choosing sine (the height is opposite the 60° angle, the ladder is the "
                 "hypotenuse) and correctly predicted that a shorter ladder at the same angle reaches lower. "
                 "Understanding matches the written work.",
                 rubric("high", "mid", prediction="high"),
                 "Named the opposite side and hypotenuse unprompted and predicted the 15 ft case correctly, "
                 "reasoning that the ratio stays the same.",
                 (A("Hi! Thanks for turning in 4.2. Let's talk about problem 5, the ladder. You started with "
                    "sin 60° = h/20 — why sine for this one?"),
                  S("the height is opposite the 60 degree angle and 20 is the ladder which is the hypotenuse", 41),
                  A("Right. If the ladder were 15 ft at the same 60° angle, would the top be higher or lower, and "
                    "how would you find it?"),
                  S("lower. same ratio so h = 15 sin 60 which is like 13 ft", 39),
                  A("Exactly — the ratio stays √3/2, so the height scales with the ladder. Nice work, thanks!")))),

        TurnIn("adopted", "4.4", 9.5, "published", 0.94, (
            Work((L(r"A = 3"), B(r"T = \frac{2\pi}{2} = \pi")), r"A = 3,\ T = \pi",
                 full("Amplitude 3 and period π are correct.", "Correct.")),
            Work((L(r"A = |-2| = 2"), L(r"T = \frac{2\pi}{1/2} = 4\pi"), B(r"\text{midline } y = 1")),
                 r"2,\ 4\pi,\ y = 1", full("Amplitude, period and midline are all correct.", "Correct.")),
            Work((L(r"\cos x = 1"), L(r"y = 4 - 1 = 3"), B(r"\max = 3 \text{ at } x = 0")),
                 r"3 \text{ at } x = 0", _missed_two_pi(3),
                 ("procedural_slip", f"{name} found the maximum 3 at x = 0 but didn't check the right endpoint of "
                                     "the closed interval, where cos x = 1 again at 2π.")),
            Work((L(r"\text{max at } \cos = -1"), L(r"h = 25 + 20 = 45 \text{ ft}"),
                  B(r"T = \frac{2\pi}{\pi/15} = 30 \text{ s}")), r"45 \text{ ft},\ 30 \text{ s}",
                 full("Maximum 45 ft and a 30 s revolution are correct.", "Both parts right, with units.")),
        ), Check(4, "pass", "Clear on why cos = −1 gives the top",
                 f"{name} explained that the minus sign makes cos = −1 the highest point and predicted a faster "
                 "revolution for a larger B. Understanding matches the work.",
                 rubric("high", "high", prediction="high"),
                 "Explained the role of the minus sign in their own words and predicted the period for "
                 "B = π/10 correctly.",
                 (A("Hi! On problem 4, the Ferris wheel, you found the max when cos = −1. Why −1 and not 1?"),
                  S("its 25 minus 20cos, so cos = -1 makes it 25 + 20. thats the top", 37),
                  A("Right. If the formula were 25 − 20cos(π/10 · t), would a revolution take more or less than "
                    "30 seconds?"),
                  S("less, 2pi over pi/10 is 20 seconds", 29),
                  A("Exactly — a bigger B spins faster. Thanks, nice reasoning!")))),
    )
