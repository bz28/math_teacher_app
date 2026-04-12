import { M, C, type StepsAnimationData } from "../steps-animation";

export const calculusDemo: StepsAnimationData = {
  problem: (
    <>
      Find the derivative of{" "}
      <M>
        f(x) = x<sup>3</sup> &middot; ln(x)
      </M>
    </>
  ),
  answer: (
    <>
      f&prime;(x) = x<sup>2</sup>(3 ln(x) + 1)
    </>
  ),
  steps: [
    {
      title: "Identify the Problem Type",
      body: (
        <>
          We need to find the derivative of{" "}
          <M>
            f(x) = x<sup>3</sup> &middot; ln(x)
          </M>
          . This function is the <C>product</C> of two simpler functions:{" "}
          <M>
            x<sup>3</sup>
          </M>{" "}
          and <M>ln(x)</M>. When we have a product of two functions, we use
          the <C>product rule</C> for differentiation. The product rule is our
          key tool here because neither function is a constant multiple of the
          other, so we can&rsquo;t simplify before differentiating.
        </>
      ),
    },
    {
      title: "Recall the Product Rule",
      body: (
        <>
          The product rule states that if <M>f(x) = u(x) &middot; v(x)</M>,
          then:
          <p className="mt-2 text-center">
            <M>
              f&prime;(x) = u&prime;(x) &middot; v(x) + u(x) &middot;
              v&prime;(x)
            </M>
          </p>
          <p className="mt-2">In our case:</p>
          <ul className="mt-1 space-y-0.5 pl-4">
            <li>
              <M>
                u(x) = x<sup>3</sup>
              </M>{" "}
              (first function)
            </li>
            <li>
              <M>v(x) = ln(x)</M> (second function)
            </li>
          </ul>
          <p className="mt-2">
            We need to find the derivatives of each part separately, then apply
            the formula.
          </p>
        </>
      ),
    },
    {
      title: "Find First Derivative",
      body: (
        <>
          Let&rsquo;s find the derivative of{" "}
          <M>
            u(x) = x<sup>3</sup>
          </M>
          :
          <p className="mt-2 text-center">
            <M>
              u&prime;(x) = 3x<sup>2</sup>
            </M>
          </p>
          <p className="mt-2">
            This uses the <C>power rule</C>: the derivative of{" "}
            <M>
              x<sup>n</sup>
            </M>{" "}
            is{" "}
            <M>
              n &middot; x<sup>n&minus;1</sup>
            </M>
            .
          </p>
        </>
      ),
    },
    {
      title: "Find Second Derivative",
      body: (
        <>
          Now let&rsquo;s find the derivative of <M>v(x) = ln(x)</M>:
          <p className="mt-2 text-center">
            <M>v&prime;(x) = 1/x</M>
          </p>
          <p className="mt-2">
            This is a <C>standard derivative</C> that we memorize: the
            derivative of the natural logarithm function is <M>1/x</M>.
          </p>
        </>
      ),
    },
    {
      title: "Apply Product Rule",
      body: (
        <>
          Now we substitute everything into the product rule formula:
          <ul className="mt-2 space-y-1 pl-4">
            <li>
              <M>
                f&prime;(x) = u&prime;(x) &middot; v(x) + u(x) &middot;
                v&prime;(x)
              </M>
            </li>
            <li>
              <M>
                f&prime;(x) = (3x<sup>2</sup>) &middot; (ln(x)) + (x
                <sup>3</sup>) &middot; (1/x)
              </M>
            </li>
            <li>
              <M>
                f&prime;(x) = 3x<sup>2</sup> ln(x) + x<sup>3</sup>/x
              </M>
            </li>
          </ul>
        </>
      ),
    },
    {
      title: "Simplify the Result",
      body: (
        <>
          Let&rsquo;s simplify the second term:
          <p className="mt-2 text-center">
            <M>
              x<sup>3</sup>/x = x<sup>3&minus;1</sup> = x<sup>2</sup>
            </M>
          </p>
          <p className="mt-2">Therefore:</p>
          <p className="mt-1 text-center">
            <M>
              f&prime;(x) = 3x<sup>2</sup> ln(x) + x<sup>2</sup>
            </M>
          </p>
          <p className="mt-2">
            We can factor out{" "}
            <M>
              x<sup>2</sup>
            </M>
            :
          </p>
          <p className="mt-1 text-center font-medium text-[color:var(--color-text)]">
            <M>
              f&prime;(x) = x<sup>2</sup>(3 ln(x) + 1)
            </M>
          </p>
        </>
      ),
    },
  ],
};
