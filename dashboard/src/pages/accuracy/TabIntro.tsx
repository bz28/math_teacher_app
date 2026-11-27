import type { ReactNode } from "react";

/** What the Accuracy page hands each tab: the shared window, and the
 *  control that changes it, which the tab places in its own filter row. */
export interface AccuracyTabProps {
  hours: string;
  windowSelect: ReactNode;
}

/** A tab's one-paragraph statement of what it measures and who judges it. */
export default function TabIntro({ pill, children }: { pill: ReactNode; children: ReactNode }) {
  return (
    <div className="accuracy-intro">
      <p>{children}</p>
      {pill}
    </div>
  );
}
