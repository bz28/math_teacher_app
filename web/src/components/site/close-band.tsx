import { ButtonLink } from "./button-link";

/**
 * The closing ask on a notebook-design page: a dark ink band, headline on
 * the left, actions on the right (stacked on phones). The older CtaBand in
 * components/landing stays until the pages that use it move over.
 */
export function InkCtaBand({
  headline,
  subhead,
  primaryLabel,
  primaryHref,
  secondaryLabel,
  secondaryHref,
}: {
  headline: string;
  subhead?: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}) {
  return (
    <section className="on-dark bg-ink text-paper">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-8 px-4 py-20 md:px-8 md:py-[88px]">
        <div className="min-w-0 max-w-[620px]">
          <h2 className="site-h2">{headline}</h2>
          {subhead && <p className="m-0 mt-5 text-lg leading-relaxed text-[#C9CFD8]">{subhead}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <ButtonLink href={primaryHref} variant="paper">
            {primaryLabel}
          </ButtonLink>
          {secondaryLabel && secondaryHref && (
            <ButtonLink href={secondaryHref} variant="underline-on-dark">
              {secondaryLabel}
            </ButtonLink>
          )}
        </div>
      </div>
    </section>
  );
}
