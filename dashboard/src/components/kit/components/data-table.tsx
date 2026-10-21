// Lists fork A: Office data as a real table, collapsing to tappable
// rows when the table itself is narrower than 768px (it queries its own
// width, so a narrow column collapses too). Columns marked `isWideOnly`
// drop out below 1024px. The whole row opens the record (a stretched
// button in the first cell), so there is one tab stop per row.
import type { ReactNode } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { CARD, cn, EYEBROW } from "@/components/kit/tokens";

export type Column<T> = {
  id: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
  isWideOnly?: boolean;
};

export type PhoneRow = {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  meta?: string;
  trailing?: ReactNode;
};

type DataTableProps<T> = {
  caption: string;
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  getRowTitle: (row: T) => string;
  getPhoneRow: (row: T) => PhoneRow;
  onOpenRow: (row: T) => void;
  isRowMuted?: (row: T) => boolean;
  // A row being opened: aria-busy, and a spinner in place of its chevron.
  isRowBusy?: (row: T) => boolean;
};

export function DataTable<T>({
  caption,
  rows,
  columns,
  getRowId,
  getRowTitle,
  getPhoneRow,
  onOpenRow,
  isRowMuted = () => false,
  isRowBusy = () => false,
}: DataTableProps<T>): ReactNode {
  const [firstColumn, ...otherColumns] = columns;
  return (
    <div className="@container">
      <div className={cn(CARD, "hidden overflow-hidden @3xl:block")}>
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-(--tl-border)">
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  style={{ width: column.width }}
                  className={cn(
                    EYEBROW,
                    "h-12 px-5 align-middle font-semibold",
                    column.isWideOnly && "hidden @5xl:table-cell",
                  )}
                >
                  {column.header}
                </th>
              ))}
              <th scope="col" className="w-14">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowId(row)}
                className={cn(
                  "group relative border-b border-(--tl-border) transition-colors duration-150 last:border-b-0 hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)",
                  isRowMuted(row) && "text-(--tl-muted)",
                )}
              >
                <td className="h-[72px] px-5 py-3 align-middle">
                  <button
                    type="button"
                    onClick={() => onOpenRow(row)}
                    aria-label={`Open ${getRowTitle(row)}`}
                    aria-busy={isRowBusy(row) || undefined}
                    className="absolute inset-0 z-0 cursor-pointer rounded-none focus-visible:-outline-offset-2"
                  />
                  <div className="relative z-10 pointer-events-none">
                    {firstColumn.render(row)}
                  </div>
                </td>
                {otherColumns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      "pointer-events-none relative z-10 px-5 py-3 align-middle text-[14px]",
                      column.isWideOnly && "hidden @5xl:table-cell",
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
                <td className="pointer-events-none relative z-10 pr-3 text-right">
                  {isRowBusy(row) ? (
                    <LoaderCircle
                      aria-hidden
                      className="kit-spin inline size-5 text-(--tl-muted)"
                    />
                  ) : (
                    <ChevronRight
                      aria-hidden
                      className="inline size-5 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul
        aria-label={caption}
        className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden @3xl:hidden")}
      >
        {rows.map((row) => {
          const phoneRow = getPhoneRow(row);
          return (
            <li key={getRowId(row)}>
              <button
                type="button"
                onClick={() => onOpenRow(row)}
                aria-busy={isRowBusy(row) || undefined}
                className={cn(
                  "flex min-h-[72px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-(--tl-tint) active:bg-(--tl-tint-strong) focus-visible:-outline-offset-2",
                  isRowMuted(row) && "text-(--tl-muted)",
                )}
              >
                {phoneRow.leading}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] leading-6 font-semibold">
                    {phoneRow.title}
                  </span>
                  {phoneRow.subtitle && (
                    <span className="block truncate text-[13px] leading-[18px] text-(--tl-muted)">
                      {phoneRow.subtitle}
                    </span>
                  )}
                  {phoneRow.meta && (
                    <span className="mt-0.5 block truncate text-[13px] leading-[18px] text-(--tl-ink-soft) tabular-nums">
                      {phoneRow.meta}
                    </span>
                  )}
                </span>
                {phoneRow.trailing}
                {isRowBusy(row) ? (
                  <LoaderCircle
                    aria-hidden
                    className="kit-spin size-5 shrink-0 text-(--tl-muted)"
                  />
                ) : (
                  <ChevronRight
                    aria-hidden
                    className="size-5 shrink-0 text-(--tl-muted)"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
