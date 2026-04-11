import { M, C, type StepsAnimationData } from "../steps-animation";

export const chemistryDemo: StepsAnimationData = {
  problem: (
    <>
      Balance the chemical equation:{" "}
      <M>
        C<sub>2</sub>H<sub>6</sub> + O<sub>2</sub> → CO<sub>2</sub> + H
        <sub>2</sub>O
      </M>
    </>
  ),
  answer: (
    <>
      2C<sub>2</sub>H<sub>6</sub> + 7O<sub>2</sub> → 4CO<sub>2</sub> + 6H
      <sub>2</sub>O
    </>
  ),
  steps: [
    {
      title: "Understand the problem",
      body: (
        <>
          We need to balance this chemical equation by finding the correct{" "}
          <C>coefficients</C> (numbers in front of each chemical formula).
          This equation represents the <C>combustion of ethane</C> (
          <M>
            C<sub>2</sub>H<sub>6</sub>
          </M>
          ), where ethane burns in oxygen to produce carbon dioxide and
          water.
          <p className="mt-2">
            The key principle is that atoms cannot be created or destroyed,
            so we must have the same number of each type of atom on both
            sides of the equation.
          </p>
        </>
      ),
    },
    {
      title: "Count initial atoms",
      body: (
        <>
          Let&rsquo;s count atoms on each side of the unbalanced equation:
          <p className="mt-2">
            <C>
              Left side (C<sub>2</sub>H<sub>6</sub> + O<sub>2</sub>):
            </C>
          </p>
          <ul className="mt-1 space-y-0.5 pl-4">
            <li>
              <M>Carbon (C): 2 atoms</M>
            </li>
            <li>
              <M>Hydrogen (H): 6 atoms</M>
            </li>
            <li>
              <M>Oxygen (O): 2 atoms</M>
            </li>
          </ul>
          <p className="mt-2">
            <C>
              Right side (CO<sub>2</sub> + H<sub>2</sub>O):
            </C>
          </p>
          <ul className="mt-1 space-y-0.5 pl-4">
            <li>
              <M>Carbon (C): 1 atom</M>
            </li>
            <li>
              <M>Hydrogen (H): 2 atoms</M>
            </li>
            <li>
              <M>Oxygen (O): 2 + 1 = 3 atoms</M>
            </li>
          </ul>
          <p className="mt-2">
            Clearly unbalanced. We have different numbers of each atom
            type.
          </p>
        </>
      ),
      question: {
        student:
          "I only see 2 oxygens on the right side, how did you get 3?",
        tutor: (
          <>
            Great question. Let&rsquo;s break down the oxygen atoms on the
            right side carefully. We have two compounds:{" "}
            <M>
              CO<sub>2</sub>
            </M>{" "}
            and{" "}
            <M>
              H<sub>2</sub>O
            </M>
            . In{" "}
            <M>
              CO<sub>2</sub>
            </M>
            , the subscript 2 tells us there are 2 oxygen atoms. In{" "}
            <M>
              H<sub>2</sub>O
            </M>
            , there&rsquo;s no subscript on the O, which means there&rsquo;s
            1 oxygen atom (when no subscript is written, it&rsquo;s
            understood to be 1). So total oxygen atoms on the right ={" "}
            <M>2 (from CO₂) + 1 (from H₂O) = 3 oxygen atoms</M>.
          </>
        ),
      },
    },
    {
      title: "Balance carbon first",
      body: (
        <>
          Since we have <C>2 carbon atoms</C> on the left (in{" "}
          <M>
            C<sub>2</sub>H<sub>6</sub>
          </M>
          ), we need <C>2 carbon atoms</C> on the right. This means we need{" "}
          <C>
            2 CO<sub>2</sub>
          </C>{" "}
          molecules:
          <p className="mt-2 text-center">
            <M>
              C<sub>2</sub>H<sub>6</sub> + O<sub>2</sub> → 2CO<sub>2</sub>{" "}
              + H<sub>2</sub>O
            </M>
          </p>
          <p className="mt-2">
            Now carbon is balanced: 2 atoms on each side.
          </p>
        </>
      ),
    },
    {
      title: "Balance hydrogen next",
      body: (
        <>
          We have <C>6 hydrogen atoms</C> on the left (in{" "}
          <M>
            C<sub>2</sub>H<sub>6</sub>
          </M>
          ), so we need <C>6 hydrogen atoms</C> on the right. Since each{" "}
          <M>
            H<sub>2</sub>O
          </M>{" "}
          has 2 hydrogen atoms, we need{" "}
          <C>
            3 H<sub>2</sub>O
          </C>{" "}
          molecules:
          <p className="mt-2 text-center">
            <M>
              C<sub>2</sub>H<sub>6</sub> + O<sub>2</sub> → 2CO<sub>2</sub>{" "}
              + 3H<sub>2</sub>O
            </M>
          </p>
          <p className="mt-2">
            Now hydrogen is balanced: 6 atoms on each side.
          </p>
        </>
      ),
    },
    {
      title: "Balance oxygen last",
      body: (
        <>
          Let&rsquo;s count oxygen atoms on the right side:
          <ul className="mt-2 space-y-0.5 pl-4">
            <li>
              From{" "}
              <M>
                2CO<sub>2</sub>
              </M>
              : <M>2 × 2 = 4</M> oxygen atoms
            </li>
            <li>
              From{" "}
              <M>
                3H<sub>2</sub>O
              </M>
              : <M>3 × 1 = 3</M> oxygen atoms
            </li>
            <li>
              <C>Total: 4 + 3 = 7 oxygen atoms</C>
            </li>
          </ul>
          <p className="mt-2">
            We need 7 oxygen atoms on the left. Since each{" "}
            <M>
              O<sub>2</sub>
            </M>{" "}
            has 2 oxygen atoms, we need{" "}
            <M>
              7/2 = 3.5 O<sub>2</sub>
            </M>{" "}
            molecules:
          </p>
          <p className="mt-2 text-center">
            <M>
              C<sub>2</sub>H<sub>6</sub> + 3.5O<sub>2</sub> → 2CO
              <sub>2</sub> + 3H<sub>2</sub>O
            </M>
          </p>
        </>
      ),
    },
    {
      title: "Eliminate fractions",
      body: (
        <>
          To avoid the fraction 3.5, we{" "}
          <C>multiply the entire equation by 2</C>:
          <p className="mt-2 text-center">
            <C>
              2C<sub>2</sub>H<sub>6</sub> + 7O<sub>2</sub> → 4CO
              <sub>2</sub> + 6H<sub>2</sub>O
            </C>
          </p>
          <p className="mt-2">Let&rsquo;s verify our balance:</p>
          <ul className="mt-1 space-y-0.5 pl-4">
            <li>
              <M>Left: C = 2 × 2 = 4, H = 2 × 6 = 12, O = 7 × 2 = 14</M>
            </li>
            <li>
              <M>
                Right: C = 4 × 1 = 4, H = 6 × 2 = 12, O = 4 × 2 + 6 × 1 =
                14
              </M>
            </li>
          </ul>
          <p className="mt-2 font-medium text-[color:var(--color-text)]">
            Perfect. All atoms are balanced.
          </p>
        </>
      ),
    },
  ],
};
