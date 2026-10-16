// The request and response behind the state on screen, so the mock can
// be checked against api/app/schemas/auth.py. Collapsed by default.
import type { ReactNode } from "react";
import { Code } from "lucide-react";
import type { WireExchange } from "@/pages/prototype/auth/lib/mock-auth-api";

type WireNoteProps = { exchange: WireExchange | null };

export default function WireNote({ exchange }: WireNoteProps): ReactNode {
  if (exchange === null) return null;

  const statusLine =
    exchange.status === null ? "no response (network)" : String(exchange.status);
  const headerLines = Object.entries(exchange.headers ?? {}).map(
    ([name, value]) => `${name}: ${value}`,
  );
  return (
    <details className="rounded-[14px] border border-dashed border-(--tl-field-border) px-3 py-2 text-[12px] leading-[18px] text-(--tl-muted)">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold">
        <Code aria-hidden className="size-3.5" />
        Wire: {exchange.method} {exchange.path} → {statusLine}
      </summary>
      <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-4 whitespace-pre-wrap">
        {`→ ${JSON.stringify(exchange.request, null, 2)}\n`}
        {headerLines.map((line) => `← ${line}\n`).join("")}
        {exchange.response === null
          ? "← (nothing)"
          : `← ${JSON.stringify(exchange.response, null, 2)}`}
      </pre>
    </details>
  );
}
