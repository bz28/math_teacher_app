import { Eyebrow } from "./eyebrow";
import { IntegrityInterview } from "./integrity-interview";

/**
 * The integrity layer — the page's signature moment, on its own dark-green
 * "spotlight" section (the demo's natural home). An animated interview where a
 * correct answer gets interrogated and flagged, resolving into the real teacher
 * verdict. Leads with the dual purpose: catches copying AND misunderstanding.
 */
export function HomeIntegrity() {
  return (
    <section
      id="integrity"
      className="relative w-full"
      style={{ background: "radial-gradient(125% 88% at 50% 0%, #0C3325 0%, #08231A 55%, #061812 100%)" }}
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow variant="invert">The integrity layer</Eyebrow>
          <h2 className="mt-6 text-display-md text-[#F4F1E8]">
            Know if they did the work&nbsp;&mdash; and if they{" "}
            <span className="font-display-serif italic text-[#7FC4A0]">understand it.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[#8FB7A4] md:text-xl">
            After a submission, Veradic asks the student to explain their own
            steps. Some can&rsquo;t because they copied. Some can&rsquo;t because
            they&rsquo;re lost. You catch both &mdash; before the test.
          </p>
        </div>

        <div className="mt-12 md:mt-16">
          <IntegrityInterview />
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-[#6E9684]">
          You see the grade, the flag, the full conversation, and how the work
          was produced &mdash; and you decide. Veradic drafts; you publish.
        </p>
      </div>
    </section>
  );
}
