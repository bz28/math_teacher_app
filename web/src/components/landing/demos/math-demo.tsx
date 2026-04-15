import { M, C, type StepsAnimationData } from "../steps-animation";

export const mathDemo: StepsAnimationData = {
  problem: (
    <>
      Solve for x:{" "}
      <span className="font-medium text-[color:var(--color-text)]">
        x<sup>2</sup> − 11x + 24 = 0
      </span>
    </>
  ),
  answer: <>x = 3 or x = 8</>,
  steps: [
    {
      title: "Identify the problem",
      body: (
        <>
          We have a quadratic equation{" "}
          <M>
            x<sup>2</sup> − 11x + 24 = 0
          </M>{" "}
          and need to find the values of <M>x</M> that make this equation
          true. This is a standard form quadratic equation where{" "}
          <M>a = 1</M>, <M>b = −11</M>, and <M>c = 24</M>. Since the leading
          coefficient is 1 and all terms are integers, we should first try{" "}
          <C>factoring</C>{" "}as it&rsquo;s often the most efficient method
          when it works.
        </>
      ),
    },
    {
      title: "Find factor pairs",
      body: (
        <>
          To factor{" "}
          <M>
            x<sup>2</sup> − 11x + 24
          </M>
          , we need two numbers that <C>multiply to give 24</C> and{" "}
          <C>add to give −11</C>. Let&rsquo;s list the factor pairs of 24:
          <ul className="mt-2 space-y-1 pl-4">
            <li>
              <M>1 × 24 = 24</M>
            </li>
            <li>
              <M>2 × 12 = 24</M>
            </li>
            <li>
              <M>3 × 8 = 24</M>
            </li>
            <li>
              <M>4 × 6 = 24</M>
            </li>
          </ul>
          <p className="mt-2">
            Since we need the sum to be negative (−11), both factors must be
            negative.
          </p>
        </>
      ),
      question: {
        student: "Why do they both have to be negative?",
        tutor: (
          <>
            Great question. When two numbers multiply to give a positive
            result (like 24) and add to give a negative result (like −11),
            both numbers must be negative. If one were positive and one
            negative, their product would be negative, not positive 24. If
            both were positive, their sum would be positive, not −11. So
            the only way to get a positive product AND a negative sum is if
            both numbers are negative. For example,{" "}
            <M>(−3) × (−8) = 24</M> and <M>(−3) + (−8) = −11</M>.
          </>
        ),
      },
    },
    {
      title: "Test factor combinations",
      body: (
        <>
          Let&rsquo;s check which pair of negative factors adds to −11:
          <ul className="mt-2 space-y-1 pl-4">
            <li>
              <M>(−1) + (−24) = −25</M>{" "}
              <span className="text-[color:var(--color-error)]">❌</span>
            </li>
            <li>
              <M>(−2) + (−12) = −14</M>{" "}
              <span className="text-[color:var(--color-error)]">❌</span>
            </li>
            <li>
              <M>(−3) + (−8) = −11</M>{" "}
              <span className="text-[color:var(--color-success)]">✅</span>
            </li>
            <li>
              <M>(−4) + (−6) = −10</M>{" "}
              <span className="text-[color:var(--color-error)]">❌</span>
            </li>
          </ul>
          <p className="mt-2">
            Perfect! The numbers <M>−3</M> and <M>−8</M> work because{" "}
            <M>(−3) × (−8) = 24</M> and <M>(−3) + (−8) = −11</M>.
          </p>
        </>
      ),
    },
    {
      title: "Write factored form",
      body: (
        <>
          Using the factors we found, we can write:
          <p className="mt-2 text-center">
            <M>
              x<sup>2</sup> − 11x + 24 = (x − 3)(x − 8) = 0
            </M>
          </p>
          <p className="mt-2">
            This works because when we expand <M>(x − 3)(x − 8)</M>, we get:
          </p>
          <p className="mt-1 text-center">
            <M>
              (x − 3)(x − 8) = x<sup>2</sup> − 8x − 3x + 24 = x<sup>2</sup>{" "}
              − 11x + 24 ✓
            </M>
          </p>
        </>
      ),
    },
    {
      title: "Apply zero product property",
      body: (
        <>
          Since <M>(x − 3)(x − 8) = 0</M>, we can use the{" "}
          <C>zero product property</C>: if two factors multiply to zero,
          then at least one factor must equal zero.
          <p className="mt-2">Therefore:</p>
          <p className="mt-1 text-center">
            <M>(x − 3) = 0 or (x − 8) = 0</M>
          </p>
          <p className="mt-2">Solving each equation:</p>
          <ul className="mt-1 space-y-1 pl-4">
            <li>
              <M>x − 3 = 0 ⇒ x = 3</M>
            </li>
            <li>
              <M>x − 8 = 0 ⇒ x = 8</M>
            </li>
          </ul>
        </>
      ),
    },
    {
      title: "Verify solutions",
      body: (
        <>
          Let&rsquo;s check both solutions in the original equation:
          <p className="mt-2">
            For <M>x = 3</M>:{" "}
            <M>
              3<sup>2</sup> − 11(3) + 24 = 9 − 33 + 24 = 0
            </M>{" "}
            <span className="text-[color:var(--color-success)]">✅</span>
          </p>
          <p className="mt-1">
            For <M>x = 8</M>:{" "}
            <M>
              8<sup>2</sup> − 11(8) + 24 = 64 − 88 + 24 = 0
            </M>{" "}
            <span className="text-[color:var(--color-success)]">✅</span>
          </p>
          <p className="mt-2 font-medium text-[color:var(--color-text)]">
            Both solutions check out!
          </p>
        </>
      ),
    },
  ],
};
