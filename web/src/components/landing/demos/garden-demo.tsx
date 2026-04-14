import { M, C, type StepsAnimationData } from "../steps-animation";

export const gardenDemo: StepsAnimationData = {
  problem: (
    <>
      A rectangular garden is 3 meters longer than it is wide. If the area is{" "}
      <M>
        108 m<sup>2</sup>
      </M>
      , find the dimensions.
    </>
  ),
  answer: <>The garden is 9 meters wide and 12 meters long.</>,
  steps: [
    {
      title: "Understand the problem",
      body: (
        <>
          We need to find the dimensions of a rectangular garden where the{" "}
          <C>length is 3 meters longer than the width</C> and the{" "}
          <C>area is 108 square meters</C>. This is a classic algebra problem
          where we set up an equation using the area formula for rectangles:
          Area = length &times; width. The key insight is to use one variable
          (the width) to express both dimensions, then solve the resulting
          quadratic equation.
        </>
      ),
    },
    {
      title: "Define the variable",
      body: (
        <>
          Let <M>w</M> = width of the garden (in meters)
          <br />
          Then the length = <M>w + 3</M> (since it&rsquo;s 3 meters longer
          than the width)
          <p className="mt-2">
            This approach reduces our problem to one unknown variable, making
            it easier to solve.
          </p>
        </>
      ),
    },
    {
      title: "Set up the equation",
      body: (
        <>
          Using the area formula:
          <p className="mt-2">Area = length &times; width</p>
          <ul className="mt-1 space-y-0.5 pl-4">
            <li>
              <M>108 = (w + 3) &times; w</M>
            </li>
            <li>
              <M>108 = w(w + 3)</M>
            </li>
            <li>
              <M>
                108 = w<sup>2</sup> + 3w
              </M>
            </li>
          </ul>
          <p className="mt-2">Rearranging to standard quadratic form:</p>
          <p className="mt-1 text-center">
            <M>
              w<sup>2</sup> + 3w &minus; 108 = 0
            </M>
          </p>
        </>
      ),
    },
    {
      title: "Factor the quadratic",
      body: (
        <>
          We need two numbers that <C>multiply to &minus;108</C> and{" "}
          <C>add to 3</C>.
          <br />
          Thinking systematically: <M>12 &times; (&minus;9) = &minus;108</M>{" "}
          and <M>12 + (&minus;9) = 3</M>{" "}
          <span className="text-[color:var(--color-success)]">✓</span>
          <p className="mt-2">So we can factor:</p>
          <p className="mt-1 text-center">
            <M>
              w<sup>2</sup> + 3w &minus; 108 = (w + 12)(w &minus; 9) = 0
            </M>
          </p>
          <p className="mt-2">
            This gives us: <M>w + 12 = 0</M> or <M>w &minus; 9 = 0</M>
            <br />
            Therefore: <M>w = &minus;12</M> or <M>w = 9</M>
          </p>
        </>
      ),
      question: {
        student: "why multiply to -108 and add to 3?",
        tutor: (
          <>
            Great question! When we have{" "}
            <M>
              w<sup>2</sup> + 3w &minus; 108 = 0
            </M>
            , we want to write it as <M>(w + a)(w + b) = 0</M>. If you expand
            that, you get{" "}
            <M>
              w<sup>2</sup> + (a + b)w + ab = 0
            </M>
            . Comparing to our equation: <M>a + b = 3</M> (the coefficient of{" "}
            <M>w</M>) and <M>ab = &minus;108</M> (the constant term).
            That&rsquo;s why we need two numbers that multiply to &minus;108
            and add to 3!
          </>
        ),
      },
    },
    {
      title: "Choose the valid solution",
      body: (
        <>
          Since width cannot be negative (it&rsquo;s a physical measurement),
          we reject <M>w = &minus;12</M>.
          <p className="mt-2">
            Therefore: <C>width = 9 meters</C>
            <br />
            And: <C>length = w + 3 = 9 + 3 = 12 meters</C>
          </p>
        </>
      ),
    },
    {
      title: "Verify the answer",
      body: (
        <>
          Let&rsquo;s check our solution:
          <ul className="mt-2 space-y-1 pl-4">
            <li>
              Length is 3 meters longer than width: <M>12 = 9 + 3</M>{" "}
              <span className="text-[color:var(--color-success)]">✓</span>
            </li>
            <li>
              Area equals 108 m&sup2;: <M>12 &times; 9 = 108</M>{" "}
              <span className="text-[color:var(--color-success)]">✓</span>
            </li>
          </ul>
          <p className="mt-2 font-medium text-[color:var(--color-text)]">
            Both conditions are satisfied!
          </p>
        </>
      ),
    },
  ],
};
