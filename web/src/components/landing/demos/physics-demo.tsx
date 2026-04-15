import { M, C, type StepsAnimationData } from "../steps-animation";

export const physicsDemo: StepsAnimationData = {
  problem: (
    <>
      A ball is launched straight toward the ground from height{" "}
      <M>h</M>. When it bounces, it loses half of its kinetic energy and
      reaches a maximum height of <M>2h</M>. What was the initial speed?
    </>
  ),
  answer: (
    <>
      v<sub>0</sub> = √(6gh)
    </>
  ),
  steps: [
    {
      title: "Problem understanding",
      body: (
        <>
          We have a ball launched downward from height <M>h</M> with some
          initial speed. When it hits the ground, it loses half its kinetic
          energy in the bounce, then reaches a maximum height of <M>2h</M>.
          We need to find the initial speed.
          <p className="mt-2">
            The key insight is to use <C>energy conservation</C> at different
            stages: before impact, after the bounce, and at maximum rebound
            height. We&rsquo;ll work backwards from the final height to
            determine what energy was needed, then trace back to find the
            initial conditions.
          </p>
        </>
      ),
    },
    {
      title: "Energy after bounce",
      body: (
        <>
          Let&rsquo;s start from what we know: after bouncing, the ball
          reaches height <M>2h</M>. Using conservation of energy from just
          after the bounce to maximum height, the kinetic energy after
          bounce equals the potential energy at height <M>2h</M>:
          <p className="mt-2 text-center">
            <C>
              KE<sub>after</sub> = mg(2h) = 2mgh
            </C>
          </p>
          <p className="mt-2">
            This tells us the kinetic energy the ball had immediately after
            bouncing off the ground.
          </p>
        </>
      ),
      question: {
        student:
          "What is the difference between kinetic and potential energy?",
        tutor: (
          <>
            Kinetic energy is the energy of motion, so it depends on how
            fast something is moving ({" "}
            <M>
              KE = ½ mv<sup>2</sup>
            </M>
            ). Potential energy is stored energy due to position. For
            gravity, it&rsquo;s <M>PE = mgh</M> where h is height above
            some reference point. In this step, we&rsquo;re using the fact
            that when the ball reaches its maximum height of <M>2h</M>,
            all its kinetic energy from just after the bounce has been
            converted to potential energy <M>mg(2h)</M>, which lets us
            work backwards to find what that kinetic energy was.
          </>
        ),
      },
    },
    {
      title: "Energy before impact",
      body: (
        <>
          The problem states that the ball{" "}
          <C>loses half its kinetic energy</C> during the bounce. This
          means:
          <p className="mt-2 text-center">
            <M>
              KE<sub>after</sub> = ½ KE<sub>before</sub>
            </M>
          </p>
          <p className="mt-2">
            Since <M>KE<sub>after</sub> = 2mgh</M>, we can find:
          </p>
          <p className="mt-1 text-center">
            <M>
              2mgh = ½ KE<sub>before</sub> ⇒ KE<sub>before</sub> = 4mgh
            </M>
          </p>
          <p className="mt-2">
            So just before hitting the ground, the ball had kinetic energy{" "}
            <M>
              ½ mv<sub>1</sub>
              <sup>2</sup> = 4mgh
            </M>
            , which gives us{" "}
            <M>
              v<sub>1</sub>
              <sup>2</sup> = 8gh
            </M>
            .
          </p>
        </>
      ),
    },
    {
      title: "Initial energy conservation",
      body: (
        <>
          Now we can use energy conservation from the initial launch to
          just before ground impact.
          <ul className="mt-2 space-y-1 pl-4">
            <li>
              Initially:{" "}
              <M>
                E<sub>initial</sub> = mgh + ½ mv<sub>0</sub>
                <sup>2</sup>
              </M>{" "}
              (potential + kinetic)
            </li>
            <li>
              Just before impact:{" "}
              <M>
                E<sub>before</sub> = ½ mv<sub>1</sub>
                <sup>2</sup> = 4mgh
              </M>{" "}
              (all kinetic)
            </li>
          </ul>
          <p className="mt-2">By conservation of energy:</p>
          <p className="mt-1 text-center">
            <M>
              mgh + ½ mv<sub>0</sub>
              <sup>2</sup> = 4mgh
            </M>
          </p>
          <p className="mt-1 text-center">
            <M>
              ½ mv<sub>0</sub>
              <sup>2</sup> = 4mgh − mgh = 3mgh
            </M>
          </p>
          <p className="mt-1 text-center">
            <C>
              v<sub>0</sub>
              <sup>2</sup> = 6gh
            </C>
          </p>
        </>
      ),
    },
    {
      title: "Final answer",
      body: (
        <>
          Taking the square root to find the initial speed:
          <p className="mt-2 text-center">
            <C>
              v<sub>0</sub> = √(6gh)
            </C>
          </p>
          <p className="mt-2">
            This makes physical sense: the ball needed significant initial
            downward speed to have enough total energy that, even after
            losing half during the bounce, it could still reach twice its
            original height.
          </p>
        </>
      ),
    },
  ],
};
