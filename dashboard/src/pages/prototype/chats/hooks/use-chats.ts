// In-memory stand-in for the Chats API: the list, one thread, and every
// action the thread offers. Each action returns what the real route
// would (a ConversationRead), but nothing leaves the page.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildChatData,
  buildCounts,
  NOW_ISO,
  toSummary,
} from "@/pages/prototype/chats/mock/chats-mock";
import type { ChatData } from "@/pages/prototype/chats/mock/chats-mock";
import type {
  ConversationRead,
  ConversationSummary,
  CountsRead,
  Language,
  MessageRead,
  SystemMessageKind,
  UserRef,
} from "@/pages/prototype/chats/types/api";

// A queued reply turns delivered after this, so the tick change shows.
const DELIVERY_DELAY_MS = 1200;

export type ChatsApi = {
  summaries: ConversationSummary[];
  counts: CountsRead;
  getConversation: (id: string) => ConversationRead | null;
  getMessages: (id: string) => MessageRead[];
  markRead: (id: string) => void;
  takeOver: (id: string) => void;
  transferToMe: (id: string) => void;
  handBack: (id: string) => void;
  markDone: (id: string) => void;
  resolveReactivation: (id: string, isApproved: boolean) => void;
  send: (id: string, body: string) => void;
  retry: (id: string, messageId: string) => void;
  setLanguage: (id: string, language: Language | null) => void;
};

function getFirstName(user: UserRef): string {
  return user.name.split(" ")[0];
}

export function useChats(me: UserRef, colleague: UserRef): ChatsApi {
  const [data, setData] = useState<ChatData>(() =>
    buildChatData(me, colleague),
  );
  const clock = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  // Each new line lands a few seconds after the last, from NOW onwards.
  function tick(): string {
    clock.current += 5;
    return new Date(Date.parse(NOW_ISO) + clock.current * 1000).toISOString();
  }

  function patch(
    id: string,
    change: (conversation: ConversationRead) => Partial<ConversationRead>,
    newMessage?: MessageRead,
  ): void {
    setData((current) => {
      const conversations = current.conversations.map((conversation) =>
        conversation.id === id
          ? { ...conversation, ...change(conversation) }
          : conversation,
      );
      const messages = newMessage
        ? { ...current.messages, [id]: [...current.messages[id], newMessage] }
        : current.messages;
      return { conversations, messages };
    });
  }

  function systemLine(kind: SystemMessageKind, body: string): MessageRead {
    return {
      id: `m-new-${crypto.randomUUID()}`,
      author_kind: "system",
      author: null,
      body,
      status: "delivered",
      created_at: tick(),
      system_kind: kind,
      error_code: null,
      reminder_child_names: null,
    };
  }

  function withNewLine(message: MessageRead) {
    return (): Partial<ConversationRead> => ({
      last_message_at: message.created_at,
      last_read_at: message.created_at,
    });
  }

  const summaries = useMemo(
    () =>
      data.conversations
        .map((conversation) =>
          toSummary(conversation, data.messages[conversation.id]),
        )
        .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at)),
    [data],
  );

  return {
    summaries,
    counts: buildCounts(summaries),
    getConversation: (id) =>
      data.conversations.find((conversation) => conversation.id === id) ??
      null,
    getMessages: (id) => data.messages[id] ?? [],
    markRead: (id) =>
      patch(id, (conversation) => ({
        last_read_at: conversation.last_message_at,
      })),
    takeOver: (id) => {
      const line = systemLine(
        "takeover_notice",
        `${getFirstName(me)} from the office has joined the chat.`,
      );
      patch(
        id,
        () => ({
          ...withNewLine(line)(),
          status: "human",
          taken_over_by: me,
          taken_over_at: line.created_at,
        }),
        line,
      );
    },
    transferToMe: (id) => {
      const line = systemLine(
        "transfer_notice",
        `${getFirstName(me)} from the office is helping you now.`,
      );
      patch(
        id,
        () => ({
          ...withNewLine(line)(),
          taken_over_by: me,
          taken_over_at: line.created_at,
        }),
        line,
      );
    },
    handBack: (id) => {
      const line = systemLine(
        "handback_notice",
        "The assistant is helping you again.",
      );
      patch(
        id,
        () => ({
          ...withNewLine(line)(),
          status: "bot",
          taken_over_by: null,
          taken_over_at: null,
        }),
        line,
      );
    },
    markDone: (id) =>
      patch(id, () => ({ flag_reason: null, flagged_at: null })),
    resolveReactivation: (id, isApproved) =>
      patch(id, (conversation) => {
        const request = conversation.reactivation_request;
        return {
          flag_reason: null,
          flagged_at: null,
          reactivation_request:
            request && isApproved
              ? { child: { ...request.child, archived: false } }
              : null,
        };
      }),
    send: (id, body) => {
      const line: MessageRead = {
        id: `m-new-${crypto.randomUUID()}`,
        author_kind: "admin",
        author: me,
        body,
        status: "queued",
        created_at: tick(),
        system_kind: null,
        error_code: null,
        reminder_child_names: null,
      };
      patch(id, withNewLine(line), line);
      const timer = window.setTimeout(() => {
        setData((current) => ({
          ...current,
          messages: {
            ...current.messages,
            [id]: current.messages[id].map((message) =>
              message.id === line.id
                ? { ...message, status: "delivered" }
                : message,
            ),
          },
        }));
      }, DELIVERY_DELAY_MS);
      timers.current.push(timer);
    },
    retry: (id, messageId) =>
      setData((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [id]: current.messages[id].map((message) =>
            message.id === messageId
              ? { ...message, status: "delivered", error_code: null }
              : message,
          ),
        },
      })),
    setLanguage: (id, language) => patch(id, () => ({ language })),
  };
}
