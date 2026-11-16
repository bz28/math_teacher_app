import { ButtonLink } from "./button-link";

/**
 * The closing ask on a marketing page: the homepage's school-bus yellow
 * band, headline on the left, actions on the right (stacked on phones).
 */
export function CloseBand({
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
    <section className="bg-sun text-ink">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-8 px-4 py-20 md:px-8 md:py-[88px]">
        <div className="min-w-0 max-w-[620px]">
          <h2 className="site-h2">{headline}</h2>
          {subhead && <p className="m-0 mt-5 text-lg leading-relaxed text-ink/80">{subhead}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <ButtonLink href={primaryHref} variant="ink">
            {primaryLabel}
          </ButtonLink>
          {secondaryLabel && secondaryHref && (
            <ButtonLink href={secondaryHref} variant="underline">
              {secondaryLabel}
            </ButtonLink>
          )}
        </div>
      </div>
    </section>
  );
}
