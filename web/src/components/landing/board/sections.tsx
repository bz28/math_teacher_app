import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import s from "./home.module.css";
import { Layers } from "./layers";
import { Reveal } from "./reveal";

/**
 * The homepage sections, "At the Board". Everything here is a server
 * component except the two pieces that move (Reveal, Layers).
 *
 * Product claims are grounded in the code: the understanding check is "a
 * brief teaching moment, not just an evaluation" and never accuses
 * (api/core/integrity_ai.py); the teacher approves every grade
 * (api/core/grading_ai.py); generated answers are re-derived before the
 * teacher sees them. Names and numbers in the examples are illustrations.
 */

/** Animation delay for one chalk line, in seconds. */
const d = (sec: number) => ({ "--d": `${sec}s` }) as CSSProperties;

function Band({
  tone,
  className = "",
  id,
  labelledBy,
  children,
}: {
  tone: "paper" | "paper2" | "board";
  className?: string;
  id?: string;
  labelledBy: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`${s[tone]} ${className} ${s.band}`}>
      <div className={s.inner}>{children}</div>
    </section>
  );
}

function LogoMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="12.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeDasharray="70 9" />
      <path d="M8.5 9.5 L14 19.5 L19.5 9.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BoardNav() {
  return (
    <header className={`${s.nav} ${s.band}`}>
      <div className={s.inner}>
        <Link href="/" className={s.logo} aria-label="Veradic home">
          <LogoMark />
          Veradic
        </Link>
        <nav className={s.navLinks} aria-label="Main">
          <a href="#learn">How students learn</a>
          <a href="#how">How it works</a>
          <a href="#rules">Responsible AI</a>
        </nav>
        <div className={s.navRight}>
          <Link className={s.signin} href="/login">
            Sign in
          </Link>
          <Link className={`${s.btn} ${s.btnInk}`} href="/demo">
            Book a demo
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="h-hero" className={`${s.hero} ${s.band}`}>
      <div className={s.inner}>
        <div>
          <h1 id="h-hero">AI can give them the answer. Veradic helps them understand it.</h1>
          <p className={s.lead}>
            Students photograph their math homework. Veradic asks each one to explain their own steps, the way a great
            teacher would, so the understanding sticks before the test. You get every grade drafted by your rules, and
            you see who still needs you.
          </p>
          <div className={s.ctas}>
            <Link className={`${s.btn} ${s.btnInk}`} href="/demo">
              Book a demo
            </Link>
            <a className={s.link} href="#learn">
              Watch a copied answer become a lesson
            </a>
          </div>
        </div>

        <div
          className={s.heroBoard}
          role="img"
          aria-label="Example: Maya wrote x = 5 for 3x + 7 = 22. Veradic asks how she got from 22 to 15. She guesses she divided. Veradic asks what undoes adding 7, and she works out that she subtracted 7. Her teacher can see where she got stuck."
        >
          <div aria-hidden="true">
            <span className={`${s.who} ${s.write}`} style={d(0)}>
              Maya R. &middot; Algebra II &middot; problem 4
            </span>
            <span className={`${s.ln} ${s.write}`} style={d(0.4)}>
              3x + 7 = 22
            </span>
            <span className={`${s.ln} ${s.write} ${s.mark}`} style={d(0.8)}>
              3x = 15
              <svg viewBox="0 0 200 14" preserveAspectRatio="none">
                <path d="M2 9 C 50 4, 120 12, 198 6" stroke="var(--chalk-yellow)" strokeWidth="3" fill="none" strokeLinecap="round" />
              </svg>
            </span>
            <span className={`${s.ln} ${s.write}`} style={d(1.2)}>
              x = 5 <span className={s.tick}>&#10003;</span>
            </span>
            <div className={`${s.ask} ${s.fade}`} style={d(1.7)}>
              <small>Veradic asked</small>Right answer. How did you get from 22 to 15?
            </div>
            <div className={`${s.reply} ${s.fade}`} style={d(2.2)}>
              <small>Maya</small>i think i divided?
            </div>
            <div className={`${s.ask} ${s.fade}`} style={d(2.7)}>
              <small>Veradic asked</small>Look at the + 7. What undoes adding 7?
            </div>
            <div className={`${s.reply} ${s.fade}`} style={d(3.2)}>
              <small>Maya</small>oh, subtract 7! 22 &minus; 7 = 15
            </div>
            <div className={`${s.verdict} ${s.fade}`} style={d(3.7)}>
              Maya worked it out herself &middot; Ms. Rivera can see where she got stuck
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const STATS = [
  {
    n: "54",
    text: "of teens have used AI chatbots for help with schoolwork.",
    src: "Pew Research Center, 2026",
    href: "https://www.pewresearch.org/internet/2026/02/24/how-teens-use-and-view-ai/",
  },
  {
    n: "62",
    text: "of students used AI on homework by December 2025, up from 48% that May.",
    src: "RAND, 2026",
    href: "https://www.rand.org/pubs/research_reports/RRA4742-1.html",
  },
  {
    n: "67",
    text: "of young people say using more AI for schoolwork hurts their critical thinking.",
    src: "RAND, 2026",
    href: "https://www.rand.org/pubs/research_reports/RRA4742-1.html",
  },
];

export function WhyNow() {
  return (
    <Band tone="paper" className={s.why} labelledBy="h-why">
      <div className={s.split}>
        <h2 className={s.h2} id="h-why">
          Homework stopped telling you who learned.
        </h2>
        <p className={s.lead}>
          A correct answer used to mean a student learned something. Now it can come from a chatbot in seconds, and the
          homework grade looks the same either way. The gap shows up on the test.
        </p>
      </div>
      <div className={s.stats}>
        {STATS.map((st) => (
          <div className={s.stat} key={st.n}>
            <b>
              {st.n}
              <span>%</span>
            </b>
            <p>{st.text}</p>
            <p className={s.src}>
              <a href={st.href} target="_blank" rel="noopener noreferrer">
                {st.src}
              </a>
            </p>
          </div>
        ))}
      </div>
      <p className={s.turn}>Students know it too. Banning AI won&rsquo;t close that gap. Teaching them to use it to understand will.</p>
    </Band>
  );
}

export function LearnStory() {
  return (
    <Band tone="board" className={s.learn} id="learn" labelledBy="h-learn">
      <div className={s.learnHead}>
        <h2 className={s.h2} id="h-learn">
          Even a copied answer can turn into a lesson.
        </h2>
        <p className={s.lead}>
          Sam got this one from an app. He can&rsquo;t explain it, and Veradic doesn&rsquo;t scold him. It teaches him the
          step he skipped, answers his questions, and lets him find the rest himself. It never gives him the answer.
        </p>
      </div>

      <Reveal className={s.story}>
        <ol className={s.arc} aria-label="How the conversation changes">
          <li>
            <span className={s.dot} style={{ background: "var(--chalk-pink)" }} />
            Can&rsquo;t explain it
          </li>
          <li>
            <span className={s.dot} style={{ background: "var(--chalk-yellow)" }} />
            Starts asking why
          </li>
          <li>
            <span className={s.dot} style={{ background: "var(--chalk-green)" }} />
            Understands it
          </li>
        </ol>

        <div>
          <div className={s.problem}>
            <span className={`${s.chalkFont} ${s.write}`} style={d(0)}>
              4(x + 1) = 24
            </span>
            <span>Sam&rsquo;s problem 6 &middot; he wrote 4x + 4 = 24, x = 5 &#10003;</span>
          </div>
          <div className={`${s.phase} ${s.phase1}`}>
            <div className={`${s.ask} ${s.fade}`} style={d(0.5)}>
              <small>Veradic asked</small>Nice, x = 5. Where did the 4x + 4 on your second line come from?
            </div>
            <div className={`${s.reply} ${s.fade}`} style={d(1.1)}>
              <small>Sam</small>honestly idk. i got it from an app
            </div>
          </div>
          <div className={`${s.phase} ${s.phase2}`}>
            <div className={`${s.ask} ${s.fade}`} style={d(1.7)}>
              <small>Veradic</small>Thanks for telling me. Let&rsquo;s figure it out. The 4 sits outside the brackets.
              What do you think it does to what&rsquo;s inside?
            </div>
            <div className={`${s.reply} ${s.fade}`} style={d(2.3)}>
              <small>Sam</small>multiplies it? so 4 times x and 4 times 1?
            </div>
            <div className={`${s.ask} ${s.fade}`} style={d(2.9)}>
              <small>Veradic</small>Exactly. That&rsquo;s distributing. Try one: what&rsquo;s 3(x + 2)?
            </div>
            <div className={`${s.reply} ${s.fade}`} style={d(3.5)}>
              <small>Sam</small>3x + 6. wait, could i have divided by 4 first?
            </div>
          </div>
          <div className={`${s.phase} ${s.phase3}`}>
            <div className={`${s.ask} ${s.fade}`} style={d(4.1)}>
              <small>Veradic</small>Good question. Try it and see.
            </div>
            <div className={`${s.reply} ${s.fade}`} style={d(4.7)}>
              <small>Sam</small>x + 1 = 6, so x = 5. oh that&rsquo;s way faster
            </div>
          </div>
        </div>

        <aside className={s.views} aria-label="The same conversation, from both sides">
          <div className={`${s.view} ${s.viewStudent} ${s.fade}`} style={d(5.2)}>
            <small>What Sam sees</small>
            <p>Thanks for walking me through that! Your teacher has everything they need. You&rsquo;ll see your grade once they publish it.</p>
          </div>
          <div className={`${s.view} ${s.viewTeacher} ${s.fade}`} style={d(5.6)}>
            <small>What Ms. Rivera sees</small>
            <p>
              <b>Couldn&rsquo;t explain his own work at first.</b> Said he used an app. Learned distributing in the chat,
              then found a faster method himself. Worth a check-in.
            </p>
            <span>Read the full conversation</span>
          </div>
        </aside>
      </Reveal>

      <div className={s.research}>
        <b>Why explaining works</b>
        <p>
          Students who put their reasoning into words learn more than students who only check their answers. A review of
          64 studies with about 6,000 students found the benefit across school subjects.
        </p>
        <p className={s.cite}>
          Bisra et al., <i>Educational Psychology Review</i>, 2018
        </p>
      </div>

      <div className={s.sidefx}>
        <div>
          <h3>And you find out who understands, before the test does.</h3>
          <p>
            The conversation that helps a student learn also shows you where every student stands. You get a clear
            picture of your class without giving another quiz.
          </p>
        </div>
        <div
          className={s.seen}
          role="img"
          aria-label="Example teacher summary: Jordan explained his steps, so his row stays quiet. Priya got a problem wrong and was taught the step in the chat. Sam couldn't explain his own work at first and learned it in the chat; his row is marked for review."
        >
          <div className={s.seenRow}>
            <b>Jordan P.</b>
            <span>Explained his steps on problem 4</span>
          </div>
          <div className={s.seenRow}>
            <b>Priya S.</b>
            <span>Got the homework wrong, was taught distributing in the chat</span>
            <em className={`${s.pill} ${s.pillAmber}`}>Tutored</em>
          </div>
          <div className={s.seenRow}>
            <b>Sam T.</b>
            <span>Couldn&rsquo;t explain his work, learned it in the chat</span>
            <em className={`${s.pill} ${s.pillRed}`}>Review</em>
          </div>
        </div>
      </div>
    </Band>
  );
}

export function Outcomes() {
  return (
    <Band tone="paper" className={s.outcomes} labelledBy="h-out">
      <h2 className={s.h2} id="h-out" style={{ maxWidth: "15em" }}>
        Built for what shows up on test day: real understanding.
      </h2>
      <p className={s.lead}>
        Test scores follow understanding. Veradic builds it with three habits, every week, on every homework.
      </p>
      <div className={s.habits}>
        <div>
          <span className={s.habitName}>Explain</span>
          <b>Students put their reasoning into words.</b>
          <p>Explaining your own steps is one of the most reliable ways to learn, and the hardest thing for a chatbot to fake.</p>
        </div>
        <div>
          <span className={s.habitName}>Practice</span>
          <b>They practice the problems the class missed.</b>
          <p>New versions of the problems you pick, ungraded, each one approved by you first.</p>
        </div>
        <div>
          <span className={s.habitName}>Catch it early</span>
          <b>Gaps surface in week 3, not on the unit test.</b>
          <p>You see who didn&rsquo;t understand while there&rsquo;s still time to reteach.</p>
        </div>
      </div>
    </Band>
  );
}

export function HowItWorks() {
  return (
    <Band tone="paper" className={s.layers} id="how" labelledBy="h-how">
      <h2 className={s.h2} id="h-how">
        One homework page, four layers.
      </h2>
      <p className={s.lead}>
        Students photograph their work. Everything Veradic adds lands on top of it, and the last layer is always yours.
      </p>
      <Layers />
    </Band>
  );
}

export function Monday() {
  return (
    <Band tone="board" className={s.monday} labelledBy="h-mon">
      <div>
        <h2 className={s.h2} id="h-mon">
          Monday&rsquo;s homework, sorted by who needs you.
        </h2>
        <p className={s.lead}>
          Open Veradic to a short list of who needs you today. Each class&rsquo;s Student Insights tab shows the problems most
          of the class got wrong.
        </p>
        <ul className={s.todo} aria-label="Example to-do list">
          <li>Talk to Sam before 1st period</li>
          <li>Reteach problem 5 (14 of 21 missed it)</li>
          <li>Review the last 3 drafts</li>
        </ul>
      </div>
      <div
        className={s.app}
        role="img"
        aria-label="Example teacher view on Monday: three students across your classes who need you today, the problem most of one class missed, and HW 5.2 with 24 grades still to post."
      >
        <div className={s.appBar}>
          <b>Your classes</b>
          <span>Monday</span>
        </div>
        <div className={s.appSec}>
          <h4>Needs you today</h4>
          <div className={s.appRow}>
            <div>
              <b>Sam T.</b>
              <span>HW 5.2 &middot; Algebra II &middot; Period 3</span>
            </div>
            <span className={`${s.pill} ${s.pillRed}`}>Flagged</span>
          </div>
          <div className={s.appRow}>
            <div>
              <b>Devon K.</b>
              <span>HW 5.2 &middot; Algebra II &middot; Period 3</span>
            </div>
            <span className={`${s.pill} ${s.pillAmber}`}>Ungraded</span>
          </div>
          <div className={s.appRow}>
            <div>
              <b>Ana L.</b>
              <span>HW 5.1 &middot; Geometry &middot; Period 5 &middot; 2 days overdue</span>
            </div>
            <span className={`${s.pill} ${s.pillAmber}`}>Overdue</span>
          </div>
        </div>
        <div className={`${s.appSec} ${s.appClass}`}>
          <h4>Student Insights &middot; Algebra II, HW 5.2</h4>
          <div>
            <b>Problem 5, distributing</b> &middot; 14 of 21 got it wrong
          </div>
          <div className={s.meter}>
            <i />
          </div>
        </div>
        <div className={s.appSec}>
          <div className={s.appRow}>
            <div>
              <b>HW 5.2 grades</b>
              <span>21 approved, 3 drafts left. Nothing posted yet.</span>
            </div>
            <span className={`${s.pill} ${s.pillAmber}`}>24 to review</span>
          </div>
        </div>
      </div>
    </Band>
  );
}

export function Practice() {
  return (
    <Band tone="paper" className={s.practice} labelledBy="h-prac">
      <h2 className={s.h2} id="h-prac" style={{ maxWidth: "16em" }}>
        They learn to use AI to ask why, not to get the answer.
      </h2>
      <p className={s.lead}>
        Your students will use AI for the rest of their lives. Veradic is where they learn to use it well. They practice
        new versions of what they missed, and when they&rsquo;re stuck they ask why. Veradic explains, then hands the next
        step back.
      </p>
      <div className={s.cards2}>
        <div
          className={s.pcard}
          role="img"
          aria-label="Example: an ungraded practice problem. The student picked a wrong answer and gets one more try. After a second miss, Veradic shows the answer and can walk through it step by step."
        >
          <div className={s.pmeta}>
            <span>A new version of problem 6</span>
            <span>Ungraded</span>
          </div>
          <p className={s.pq}>Solve: 5(x &minus; 2) = 15</p>
          <div className={s.opts}>
            <span>x = 5</span>
            <span className={s.pick}>x = 1</span>
            <span>x = 3</span>
            <span>x = 17/5</span>
          </div>
          <p className={s.nudge}>Not quite, try again! Miss it twice and Veradic shows the answer, then walks through it with you.</p>
        </div>
        <div
          className={s.pcard}
          role="img"
          aria-label="Example: on 3(x + 2) = 21 a student asks why they multiply the 3 by the 2. Veradic explains the 3 multiplies everything in the brackets and asks what 3 times 2 is. The student answers 6."
        >
          <div className={s.pmeta}>
            <span>Practice &middot; problem 2 of 5</span>
            <span>Step 1 of 3</span>
          </div>
          <p className={s.handStep}>3(x + 2) = 21</p>
          <div className={s.stu}>why do I multiply the 3 by the 2?</div>
          <p className={s.vbubble}>The 3 multiplies everything in the brackets, the x and the 2. So what&rsquo;s 3 &times; 2?</p>
          <div className={s.stu}>6! so 3x + 6 = 21</div>
        </div>
      </div>
      <div className={s.promises}>
        <p>
          <b>Practice is ungraded.</b>Getting one wrong is safe, so students actually try.
        </p>
        <p>
          <b>It stays on your class&rsquo;s problems.</b>There&rsquo;s no open chat box to paste homework into.
        </p>
        <p>
          <b>You see who practiced.</b>And which problems they&rsquo;re still stuck on.
        </p>
      </div>
    </Band>
  );
}

export function Prep() {
  return (
    <Band tone="paper2" className={s.prep} labelledBy="h-prep">
      <div className={s.split}>
        <h2 className={s.h2} id="h-prep">
          Sunday-night prep takes five minutes.
        </h2>
        <p className={s.lead}>
          Point Veradic at your own chapter. It writes the problems with full worked solutions, and nothing goes to
          students until you&rsquo;ve reviewed it.
        </p>
      </div>
      <ol className={s.flow}>
        <li>
          <b>Pick your chapter</b>
          <p>Upload a worksheet or textbook pages, or name a topic.</p>
          <div className={s.mini}>
            <span className={s.chip}>Systems &amp; Matrices &mdash; Ch. 5.pdf</span>
            <span className={s.chip}>10 problems</span>
            <span className={s.chip}>mixed difficulty</span>
          </div>
        </li>
        <li>
          <b>Review every solution</b>
          <p>Every problem comes with a full worked solution. Read it step by step, change anything, and approve only what you&rsquo;d hand out.</p>
          <div className={s.mini}>
            <span className={s.ok}>10 problems with solutions, ready for your review</span>
          </div>
        </li>
        <li>
          <b>Fix it in plain English</b>
          <p>Ask for changes the way you&rsquo;d tell a colleague, then assign it before you leave the building.</p>
          <div className={s.mini}>
            <span className={s.typed}>make #4 a word problem about ticket sales</span>
          </div>
        </li>
      </ol>
    </Band>
  );
}

const RULES: [string, string][] = [
  ["The teacher approves every grade.", "AI drafts. Nothing reaches a student until you say so."],
  ["It never does students’ homework for them.", "The understanding check never gives the answer. In practice it shows one only after two tries, then walks through it."],
  ["It helps students think, and never accuses them.", "It asks them to explain. You decide what their answers mean."],
  ["You review every problem before students see it.", "Each one comes with a full worked solution you can read and edit."],
  ["Student work never trains AI.", "Not ours, not anyone else’s."],
  ["Your data stays your district’s.", "Export or delete it any time."],
];

export function Rules() {
  return (
    <Band tone="board" className={s.rules} id="rules" labelledBy="h-rules">
      <div>
        <h2 className={s.h2} id="h-rules">
          Responsible AI, written as classroom rules.
        </h2>
        <p className={s.lead}>AI in school should make students think more. These rules are built into how Veradic works.</p>
        <ul className={s.badges} aria-label="Compliance">
          <li>FERPA</li>
          <li>COPPA</li>
          <li>We sign your NDPA</li>
          <li>Hosted in the U.S.</li>
        </ul>
        <p style={{ marginTop: 28 }}>
          <Link className={s.link} href="/trust">
            Read how we protect student data
          </Link>
        </p>
      </div>
      <div className={s.poster}>
        <h3>Veradic&rsquo;s classroom rules</h3>
        <ol>
          {RULES.map(([rule, note]) => (
            <li key={rule}>
              <span>
                {rule}
                <small>{note}</small>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Band>
  );
}

const OFFERS: [string, string][] = [
  ["Set up on your own material", "We load your chapters and grading rules with you, so the first homework is graded the way you’d grade it."],
  ["A direct line to the team", "Your questions go straight to the people building Veradic."],
  ["Your district’s paperwork, handled", "We sign your data privacy agreement and walk your IT team through how student data is handled."],
  ["Shape what comes next", "Founding schools help decide what we build next, including more physics and chemistry."],
];

export function FoundingSchools() {
  return (
    <Band tone="paper2" className={s.founding} id="founding" labelledBy="h-found">
      <div>
        <h2 className={s.h2} id="h-found" style={{ fontSize: "clamp(32px, 4vw, 52px)" }}>
          We&rsquo;re working with a small group of schools this year.
        </h2>
        <p className={s.lead}>
          Veradic is invite-only while we work closely with our first schools. If your math department wants to see what
          its students actually understand, we&rsquo;d like to hear from you.
        </p>
        <p style={{ marginTop: 28 }}>
          <Link className={`${s.btn} ${s.btnGreen}`} href="/demo">
            Book a demo
          </Link>
        </p>
      </div>
      <div className={s.offers}>
        {OFFERS.map(([t, b]) => (
          <div key={t}>
            <b>{t}</b>
            <p>{b}</p>
          </div>
        ))}
      </div>
    </Band>
  );
}

const FAQ: [string, string][] = [
  [
    "Will this improve test scores?",
    "Veradic is built around three habits research links to stronger learning: explaining your reasoning, practicing what you missed, and catching gaps early. We're measuring results with our first schools now.",
  ],
  [
    "Does the AI grade on its own?",
    "No. Veradic drafts every grade with a reason for each point. Nothing reaches a student until the teacher approves it, and any point can be changed.",
  ],
  [
    "Is the understanding check a cheating detector?",
    "No. It's a short learning conversation: students explain their steps and get guided when they're stuck. Because of that, it also shows you who understands. If a student can't explain their work, you see the conversation and decide what it means.",
  ],
  [
    "Does it replace Google Classroom or Canvas?",
    "No. Veradic works alongside your learning platform and focuses on homework: grading, understanding, and practice.",
  ],
  [
    "Which subjects does it support?",
    "Math, fully. Physics and chemistry are partly supported and improving. We'll show you exactly what works for your courses on the demo.",
  ],
  [
    "How do students use it?",
    "They photograph their handwritten homework on a phone or upload it on the web, then answer a short understanding check.",
  ],
  [
    "What happens to student data?",
    "We work as a school official under FERPA, follow COPPA, sign your district's data privacy agreement, and host in the U.S. Student work is never used to train AI. Your school can export or delete its data at any time.",
  ],
];

export function Faq() {
  return (
    <Band tone="paper" className={s.faq} labelledBy="h-faq">
      <h2 className={s.h2} id="h-faq" style={{ fontSize: "clamp(30px, 3.6vw, 44px)" }}>
        Questions schools ask
      </h2>
      <div>
        {FAQ.map(([q, a], i) => (
          <details key={q} open={i === 0}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </Band>
  );
}

export function Close() {
  return (
    <section aria-labelledby="h-close" className={`${s.close} ${s.band}`}>
      <div className={s.inner}>
        <h2 id="h-close">AI can give them the answer. Veradic helps them understand it.</h2>
        <div className={s.ctas}>
          <Link className={`${s.btn} ${s.btnInk}`} href="/demo">
            Book a 20-minute demo
          </Link>
          <Link className={s.link} href="/for-districts">
            For schools &amp; districts
          </Link>
        </div>
        <p className={s.tagline}>Every answer, explained.</p>
      </div>
    </section>
  );
}

export function BoardFooter() {
  return (
    <footer className={`${s.foot} ${s.band}`}>
      <div className={s.inner}>
        <div className={s.footBrand}>
          <Link href="/" className={s.logo} style={{ color: "var(--chalk)" }}>
            <LogoMark />
            Veradic
          </Link>
          <p>Classroom AI that helps students understand their math homework, and shows teachers who does.</p>
        </div>
        <nav aria-labelledby="f-product">
          <h2 id="f-product">Product</h2>
          <a href="#learn">How students learn</a>
          <a href="#how">How it works</a>
          <a href="#rules">Responsible AI</a>
          <Link href="/for-districts">For districts</Link>
          <Link href="/demo">Book a demo</Link>
        </nav>
        <nav aria-labelledby="f-subjects">
          <h2 id="f-subjects">Subjects</h2>
          <Link href="/subjects/math">Math</Link>
          <Link href="/subjects/physics">Physics</Link>
          <Link href="/subjects/chemistry">Chemistry</Link>
        </nav>
        <nav aria-labelledby="f-company">
          <h2 id="f-company">Company</h2>
          <Link href="/trust">Trust &amp; security</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/support">Support</Link>
          <Link href="/login">Sign in</Link>
        </nav>
        <div className={s.footSmall}>
          <span>&copy; {new Date().getFullYear()} Veradic LLC. All rights reserved.</span>
          <span>Students and classes shown are examples.</span>
        </div>
      </div>
    </footer>
  );
}
