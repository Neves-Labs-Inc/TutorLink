// Who is answering and the one way forward: Take over from the bot, or
// from the colleague who holds the chat.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type FooterNoticeProps = {
  icon: LucideIcon;
  text: string;
  children: ReactNode;
};

export default function FooterNotice({
  icon: Icon,
  text,
  children,
}: FooterNoticeProps): ReactNode {
  return (
    <div className="flex flex-col gap-3 @md:flex-row @md:items-center">
      <p className="flex min-w-0 flex-1 items-start gap-2 text-[14px] leading-5 text-(--tl-ink-soft)">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-(--tl-muted)" />
        {text}
      </p>
      {children}
    </div>
  );
}
