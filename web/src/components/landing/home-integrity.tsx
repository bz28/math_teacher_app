import { IntegrityInterview } from "./integrity-interview";

/**
 * The integrity layer — the page's signature moment, on its own dark-green
 * "spotlight" section (the demo's natural home). An animated interview where a
 * correct answer gets interrogated and flagged, resolving into the real teacher
 * verdict. Leads with the dual purpose: catches copying AND misunderstanding.
 *
 * Split layout on desktop, and that is the structural point of the section
 * rather than a styling preference. Every other block on this page is a
 * centred column, so four of them in a row read as one idea repeated four
 * times however good the copy is. Putting the argument beside the proof
 * does two things at once: it breaks that cadence, and it stops the
 * interview being a 600px card marooned in a 1152px container with the
 * headline towering over it. The demo IS the argument here — it should not
 * be the smallest thing in its own section.
 */
export function HomeIntegrity() {
  return (
    <section
      id="integrity"
      className="relative w-full"
      style={{ background: "radial-gradient(125% 88% at 50% 0%, #0C3325 0%, #08231A 55%, #061812 100%)" }}
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-16 md:px-8 md:py-24">
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:gap-16">
          {/* The argument. Left-anchored, not centred — a centred column
              sitting beside an artifact gives the eye two competing axes. */}
          <div className="max-w-xl">
            <h2 className="text-display-md text-[#F4F1E8]">
              Know if they truly{" "}
              <span className="font-display-serif italic text-[#7FC4A0]">understand it</span>
              &nbsp;&mdash; not just whether the answer&rsquo;s right.
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-[#8FB7A4] md:text-xl">
              After a submission, Veradic asks the student to explain their own
              steps &mdash; the understanding a grade alone can&rsquo;t show. Some
              can&rsquo;t explain it because they&rsquo;re lost; some because they
              didn&rsquo;t really do the work. You see both, before the test does.
            </p>
            {/* Promoted from a centred footnote below the demo. Down there
                it trailed a 470px-tall animation and got read last, if at
                all — but it is the reassurance a teacher wants *while*
                watching an AI interrogate their student, so it belongs
                beside the claim it qualifies, not after the evidence. */}
            <p className="mt-8 border-t border-[#1C4030] pt-6 text-sm leading-relaxed text-[#6E9684]">
              You see the grade, the flag, the full conversation, and how the work
              was produced &mdash; and you decide. Veradic drafts; you publish.
            </p>
          </div>

          {/* The proof. */}
          <div className="min-w-0">
            <IntegrityInterview />
          </div>
        </div>
      </div>
    </section>
  );
}
