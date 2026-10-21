// A group's fields: one column, two-up once each cell gets at least
// ~260px. It measures its own width (not the page's), because at 1024px
// the jump column leaves the groups too narrow for two cells.
import type { ReactNode } from "react";

type FieldGridProps = { children: ReactNode };

export default function FieldGrid({ children }: FieldGridProps): ReactNode {
  return (
    <div className="@container/fields">
      {/* 544px = two 260px cells and the 24px gap. */}
      <div className="grid gap-6 @min-[544px]/fields:grid-cols-2">
        {children}
      </div>
    </div>
  );
}
