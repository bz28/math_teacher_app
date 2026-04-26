import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * Form field wrapper with a small uppercase label above the input.
 *
 * Generates a unique id and binds the label to its single child via
 * htmlFor + a cloned id prop, so the label is programmatically
 * associated with the input for screen readers without the call site
 * having to wire it up. If the consumer already passes an id on the
 * child, that id wins and the label uses it.
 */
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  // Only clone single, valid React elements. Plain text/fragments fall
  // through unchanged — the label still renders, just without
  // programmatic association (no worse than before for those cases).
  const child = isValidElement(children) ? children : null;
  const childId =
    (child?.props as { id?: string } | undefined)?.id ?? generatedId;
  const associated = child
    ? cloneElement(child as ReactElement<{ id?: string }>, { id: childId })
    : children;
  return (
    <div>
      <label
        htmlFor={child ? childId : undefined}
        className="block text-xs font-bold uppercase tracking-wider text-text-muted"
      >
        {label}
      </label>
      <div className="mt-1">{associated}</div>
    </div>
  );
}
