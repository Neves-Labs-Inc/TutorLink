// What a chat looks like once handed back to the bot, before the API
// says so. The server clears the flag on release, except a reactivation
// request, which still waits for the office.
import type {
  Conversation,
  ConversationDetail,
} from "@/lib/queries/conversations";

type HandBackFields = Pick<
  Conversation,
  "status" | "taken_over_by" | "flag_reason" | "flagged_at"
>;

function getHandedBackFields(chat: HandBackFields): HandBackFields {
  const keepsFlag = chat.flag_reason === "reactivation_request";
  return {
    status: "bot",
    taken_over_by: null,
    flag_reason: keepsFlag ? chat.flag_reason : null,
    flagged_at: keepsFlag ? chat.flagged_at : null,
  };
}

export function getHandedBackDetail(
  detail: ConversationDetail,
): ConversationDetail {
  return { ...detail, ...getHandedBackFields(detail), taken_over_at: null };
}

export function getHandedBackRow(row: Conversation): Conversation {
  return { ...row, ...getHandedBackFields(row) };
}
