// Past the Guardian's 24-hour window the office can't reply on WhatsApp,
// so the footer says how to reach them instead.
import type { ReactNode } from "react";
import { Bot, Copy, PhoneOff } from "lucide-react";
import { Button, TextLink } from "@/components/kit/components/button";
import { useToast } from "@/components/kit/overlays/use-toast";
import { formatDayAndTime } from "@/lib/chats/time";

type ClosedWindowNoticeProps = {
  phone: string;
  firstName: string;
  closedAt: string | null;
  // Set for the holder only.
  onHandBack: (() => void) | null;
};

export default function ClosedWindowNotice({
  phone,
  firstName,
  closedAt,
  onHandBack,
}: ClosedWindowNoticeProps): ReactNode {
  const { showToast } = useToast();

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(phone);
      showToast({ tone: "success", message: "Number copied" });
    } catch (error) {
      console.warn("chat footer: copy number failed", { error });
      showToast({
        tone: "error",
        message: "Couldn’t copy the number. Select it and copy it by hand.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-3 @md:flex-row @md:items-center">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[14px] leading-5 font-semibold text-(--tl-danger)">
          <PhoneOff aria-hidden className="size-4 shrink-0" />
          Reply outside the bot
        </p>
        <p className="mt-0.5 text-[14px] leading-5 text-(--tl-ink-soft)">
          WhatsApp only lets the office reply within 24 hours of {firstName}’s
          last message
          {closedAt !== null && ` (closed ${formatDayAndTime(closedAt)})`}. Call
          or text{" "}
          <span className="font-semibold whitespace-nowrap tabular-nums select-all">{phone}</span>.
        </p>
        {onHandBack && (
          <div className="mt-1">
            <TextLink data-hand-back onClick={onHandBack} className="text-[13px]">
              <Bot aria-hidden className="size-4" />
              Hand back to bot
            </TextLink>
          </div>
        )}
      </div>
      <Button
        variant="outline"
        icon={Copy}
        data-copy-number
        onClick={() => void handleCopy()}
        className="w-full @md:w-auto"
      >
        Copy number
      </Button>
    </div>
  );
}
