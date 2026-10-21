// The Edit tab: subject, message, and chips that put a placeholder in the
// message at the caret.
import { useRef } from "react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  TextAreaField,
  TextField,
} from "@/components/kit/components/fields";
import type {
  TemplateError,
  TemplateSectionConfig,
} from "@/lib/settings/emailTemplates";

const PLACEHOLDER_LABELS: Record<string, string> = {
  name: "Their name",
  actor_name: "Who invited them",
  link: "The link",
};

type EmailEditFieldsProps = {
  section: TemplateSectionConfig;
  subject: string;
  body: string;
  error: TemplateError | null;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
};

export default function EmailEditFields({
  section,
  subject,
  body,
  error,
  onSubjectChange,
  onBodyChange,
}: EmailEditFieldsProps): ReactNode {
  // The kit's TextAreaField takes no ref, so find the textarea inside.
  const bodyRef = useRef<HTMLDivElement>(null);

  function handleInsert(name: string): void {
    const field = bodyRef.current?.querySelector("textarea") ?? null;
    const token = `{${name}}`;
    const start = field?.selectionStart ?? body.length;
    const end = field?.selectionEnd ?? body.length;
    // Rendered before the caret is placed: a controlled value that changes
    // would otherwise send the caret to the end.
    flushSync(() =>
      onBodyChange(body.slice(0, start) + token + body.slice(end)),
    );
    field?.focus();
    field?.setSelectionRange(start + token.length, start + token.length);
  }

  return (
    <div className="flex flex-col gap-5">
      <TextField
        label="Subject"
        value={subject}
        onChange={(event) => onSubjectChange(event.target.value)}
        error={error?.field === "subject" ? error.message : undefined}
      />
      <div ref={bodyRef} className="flex flex-col gap-3">
        <TextAreaField
          label="Message"
          rows={12}
          value={body}
          onChange={(event) => onBodyChange(event.target.value)}
          error={error?.field === "body" ? error.message : undefined}
          help="Plain text. The link becomes a button."
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-(--tl-muted)">Insert:</span>
          {section.placeholders.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => handleInsert(name)}
              className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-(--tl-border) bg-(--tl-surface) px-4 text-[13px] font-medium transition-colors duration-150 hover:border-(--tl-hero) hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)"
            >
              {PLACEHOLDER_LABELS[name] ?? name}
              <code className="text-(--tl-muted)">{`{${name}}`}</code>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
