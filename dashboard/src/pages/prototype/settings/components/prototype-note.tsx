// A dashed "?" marker on anything the prototype had to guess: an open
// flow question or a field the API doesn't send yet. Not part of the
// design; hover or focus it to read the note.
import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";

type PrototypeNoteProps = { note: string };

export default function PrototypeNote({ note }: PrototypeNoteProps): ReactNode {
  return (
    <span
      tabIndex={0}
      title={note}
      aria-label={`Prototype note: ${note}`}
      className="inline-flex size-6 shrink-0 cursor-help items-center justify-center rounded-full border border-dashed border-fuchsia-500 align-middle text-fuchsia-500"
    >
      <CircleHelp aria-hidden className="size-3.5" />
    </span>
  );
}
