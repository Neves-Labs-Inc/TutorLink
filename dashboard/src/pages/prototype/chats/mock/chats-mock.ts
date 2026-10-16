// Mock Chats data in the real wire shapes (types/api.ts). "Now" is the
// kit's NOW (Tue 13 Oct 2026, 8:40 AM, business time is Doral, FL).
// Who holds a Taken over chat depends on who is looking, so the data is
// built per viewer: `me` is the signed-in Admin or Manager, `colleague`
// the other Office member.
import type {
  ConversationRead,
  ConversationSummary,
  CountsRead,
  MessageRead,
  UserRef,
} from "@/pages/prototype/chats/types/api";

export const NOW_ISO = "2026-10-13T08:40:00-04:00";

export const OFFICE_USERS = {
  admin: { id: "u-maria", name: "Maria Lopez" },
  manager: { id: "u-daniela", name: "Daniela Cruz" },
} satisfies Record<string, UserRef>;

export type ChatData = {
  conversations: ConversationRead[];
  messages: Record<string, MessageRead[]>;
};

type MessageInput = Partial<MessageRead> &
  Pick<MessageRead, "author_kind" | "body" | "created_at">;

let messageSeq = 0;

function message(input: MessageInput): MessageRead {
  messageSeq += 1;
  const isInbound = input.author_kind === "client";
  return {
    id: `m-${messageSeq}`,
    author: null,
    status: isInbound ? "received" : "delivered",
    system_kind: null,
    error_code: null,
    reminder_child_names: null,
    ...input,
  };
}

function client(at: string, body: string): MessageRead {
  return message({ author_kind: "client", body, created_at: at });
}

function bot(at: string, body: string): MessageRead {
  return message({ author_kind: "bot", body, created_at: at, status: "sent" });
}

function staff(at: string, author: UserRef, body: string): MessageRead {
  return message({ author_kind: "admin", author, body, created_at: at });
}

function notice(
  at: string,
  kind: NonNullable<MessageRead["system_kind"]>,
  body: string,
  extra: Partial<MessageRead> = {},
): MessageRead {
  return message({
    author_kind: "system",
    system_kind: kind,
    body,
    created_at: at,
    ...extra,
  });
}

type ConversationInput = Partial<ConversationRead> &
  Pick<ConversationRead, "id" | "phone_number" | "guardian">;

function conversation(
  input: ConversationInput,
  thread: MessageRead[],
): ConversationRead {
  const last = thread[thread.length - 1];
  const lastClient = [...thread]
    .reverse()
    .find((item) => item.author_kind === "client");
  return {
    status: "bot",
    taken_over_by: null,
    taken_over_at: null,
    last_message_at: last.created_at,
    last_read_at: last.created_at,
    flag_reason: null,
    flagged_at: null,
    message_count: thread.length,
    created_at: thread[0].created_at,
    reactivation_request: null,
    is_window_open: true,
    last_client_message_at: lastClient?.created_at ?? null,
    language: "en",
    ...input,
  };
}

export function buildChatData(me: UserRef, colleague: UserRef): ChatData {
  messageSeq = 0;
  const threads: Record<string, MessageRead[]> = {
    "c-laura": [
      client("2026-10-12T18:02:00-04:00", "Hola, buenas tardes"),
      bot(
        "2026-10-12T18:02:10-04:00",
        "¡Hola Laura! ¿En qué te puedo ayudar? Puedo reservar, cambiar o cancelar sesiones para Mateo.",
      ),
      client(
        "2026-10-13T08:29:00-04:00",
        "Quiero reservar una sesión de lectura para mi otra hija, Lucía. Es nueva.",
      ),
      bot(
        "2026-10-13T08:29:20-04:00",
        "Lucía todavía necesita una sesión de evaluación antes de reservar. Le pasé tu pedido a la oficina y te escribirán pronto.",
      ),
      client(
        "2026-10-13T08:31:00-04:00",
        "¿Podemos mover la sesión del jueves a las 6 también?",
      ),
    ],
    "c-carlos": [
      client(
        "2026-10-13T08:02:00-04:00",
        "What did the evaluation show for Valentina? Is she ready for 6th grade math?",
      ),
      bot(
        "2026-10-13T08:02:15-04:00",
        "I can't answer that one, so I've passed it to the office. Someone will reply here soon.",
      ),
    ],
    "c-sandra": [
      client("2026-10-12T09:08:00-04:00", "I sent a photo of the homework"),
      client("2026-10-12T09:10:00-04:00", "[Image]"),
      bot(
        "2026-10-12T09:10:30-04:00",
        "Sorry, I couldn't understand that. I've let the office know.",
      ),
    ],
    "c-andrea": [
      client(
        "2026-10-13T07:15:00-04:00",
        "Hi! My husband already has an account. Can I add our son Diego to my number too?",
      ),
      bot(
        "2026-10-13T07:15:20-04:00",
        "Thanks Andrea. To keep Diego's details safe, the office needs to link you to his account. They'll be in touch.",
      ),
    ],
    "c-roberto": [
      client("2026-10-11T19:12:00-04:00", "cancel"),
      bot(
        "2026-10-11T19:12:10-04:00",
        "Which session would you like to cancel? Reply with its number: 1) Wed 14 Oct 4:00 PM 2) Fri 16 Oct 4:00 PM",
      ),
      client("2026-10-11T19:16:00-04:00", "the one next week not this one"),
      bot(
        "2026-10-11T19:16:10-04:00",
        "Sorry, please reply with 1 or 2.",
      ),
      client("2026-10-11T19:20:00-04:00", "next week"),
      bot(
        "2026-10-11T19:20:10-04:00",
        "I'm having trouble with this one, so I've asked the office to help.",
      ),
    ],
    "c-elena": [
      client(
        "2026-10-12T16:05:00-04:00",
        "Hello, Sofía would like to start classes again after the summer. Is that possible?",
      ),
      bot(
        "2026-10-12T16:05:20-04:00",
        "I've asked the office to reactivate Sofía. You'll hear back here soon.",
      ),
    ],
    "c-patricia": [
      client(
        "2026-10-13T07:58:00-04:00",
        "Can the tutor come to my mother's house on Thursday instead?",
      ),
      bot(
        "2026-10-13T07:58:20-04:00",
        "That address isn't saved yet, so I've passed this to the office.",
      ),
      notice(
        "2026-10-13T08:10:00-04:00",
        "takeover_notice",
        `${me.name.split(" ")[0]} from the office has joined the chat.`,
      ),
      staff(
        "2026-10-13T08:11:00-04:00",
        me,
        "Hi Patricia! Sure. What's the address? I'll add it to your account.",
      ),
      client(
        "2026-10-13T08:20:00-04:00",
        "4410 NW 79th Ave, Doral. Thank you!",
      ),
      staff(
        "2026-10-13T08:24:00-04:00",
        me,
        "Done. Thursday's session with Ana is now at that address, 11:30 AM.",
      ),
      client("2026-10-13T08:25:00-04:00", "Thanks! See you at 11:30."),
    ],
    "c-jorge": [
      client(
        "2026-10-11T10:00:00-04:00",
        "My daughter has a fever, we need to skip tomorrow",
      ),
      notice(
        "2026-10-11T10:04:00-04:00",
        "takeover_notice",
        `${me.name.split(" ")[0]} from the office has joined the chat.`,
      ),
      staff(
        "2026-10-11T10:05:00-04:00",
        me,
        "So sorry to hear that. I've cancelled tomorrow's session. Get well soon!",
      ),
      staff(
        "2026-10-12T15:30:00-04:00",
        me,
        "Hi Jorge, how is Camila feeling? Shall we book Thursday instead?",
        // Sent after the window closed: WhatsApp would not deliver it.
      ),
    ],
    "c-ricardo": [
      client(
        "2026-10-13T07:40:00-04:00",
        "Buenos días, ¿la tutora puede llegar 15 minutos tarde hoy?",
      ),
      notice(
        "2026-10-13T07:45:00-04:00",
        "takeover_notice",
        `${colleague.name.split(" ")[0]} from the office has joined the chat.`,
      ),
      staff(
        "2026-10-13T07:46:00-04:00",
        colleague,
        "¡Buenos días Ricardo! Sí, Ana llegará a las 4:15. ¿Está bien?",
      ),
      client("2026-10-13T07:50:00-04:00", "Ok, perfecto. Gracias."),
    ],
    "c-new": [
      client("2026-10-13T06:50:00-04:00", "Hi, I saw your flyer at school"),
      bot(
        "2026-10-13T06:50:15-04:00",
        "Welcome to TutorLink! What's your full name?",
      ),
      client("2026-10-13T06:52:00-04:00", "Gabriela Fuentes"),
      bot(
        "2026-10-13T06:52:10-04:00",
        "Thanks, Gabriela. How many children would you like tutoring for?",
      ),
    ],
    "c-monica": [
      client("2026-10-04T17:40:00-04:00", "Perfect, thank you"),
      notice(
        "2026-10-11T17:00:00-04:00",
        "booking_reminder",
        "Hi Mónica! Nothing is booked for Andrés and Lucas next week. Reply here to book a session.",
        { reminder_child_names: ["Andrés", "Lucas"] },
      ),
      notice(
        "2026-10-12T11:15:00-04:00",
        "number_change_note",
        "Number changed from +1 305 555 0110 to +1 305 555 0187.",
        { status: "sent" },
      ),
    ],
  };

  // Jorge's last reply went out after his window closed.
  const jorge = threads["c-jorge"];
  jorge[jorge.length - 1] = {
    ...jorge[jorge.length - 1],
    status: "failed",
    error_code: "window_closed",
  };

  const conversations: ConversationRead[] = [
    conversation(
      {
        id: "c-laura",
        phone_number: "+1 305 555 0142",
        guardian: { id: "g-laura", name: "Laura Martinez" },
        flag_reason: "booking_request",
        flagged_at: "2026-10-13T08:29:20-04:00",
        last_read_at: "2026-10-12T18:02:10-04:00",
        language: "es",
      },
      threads["c-laura"],
    ),
    conversation(
      {
        id: "c-carlos",
        phone_number: "+1 786 555 0118",
        guardian: { id: "g-carlos", name: "Carlos Rojas" },
        flag_reason: "question",
        flagged_at: "2026-10-13T08:02:15-04:00",
        last_read_at: null,
      },
      threads["c-carlos"],
    ),
    conversation(
      {
        id: "c-sandra",
        phone_number: "+1 305 555 0163",
        guardian: { id: "g-sandra", name: "Sandra Reyes" },
        flag_reason: "parse_error",
        flagged_at: "2026-10-12T09:10:30-04:00",
      },
      threads["c-sandra"],
    ),
    conversation(
      {
        id: "c-andrea",
        phone_number: "+1 954 555 0131",
        guardian: { id: "g-andrea", name: "Andrea Silva" },
        flag_reason: "guardian_link_request",
        flagged_at: "2026-10-13T07:15:20-04:00",
        last_read_at: null,
      },
      threads["c-andrea"],
    ),
    conversation(
      {
        id: "c-roberto",
        phone_number: "+1 305 555 0175",
        guardian: { id: "g-roberto", name: "Roberto Díaz" },
        flag_reason: "stuck",
        flagged_at: "2026-10-11T19:20:10-04:00",
        is_window_open: false,
      },
      threads["c-roberto"],
    ),
    conversation(
      {
        id: "c-elena",
        phone_number: "+1 786 555 0124",
        guardian: { id: "g-elena", name: "Elena Gómez" },
        flag_reason: "reactivation_request",
        flagged_at: "2026-10-12T16:05:20-04:00",
        reactivation_request: {
          child: { id: "ch-sofia", name: "Sofía Gómez", archived: true },
        },
      },
      threads["c-elena"],
    ),
    conversation(
      {
        id: "c-patricia",
        phone_number: "+1 305 555 0150",
        guardian: { id: "g-patricia", name: "Patricia Ortiz" },
        status: "human",
        taken_over_by: me,
        taken_over_at: "2026-10-13T08:10:00-04:00",
      },
      threads["c-patricia"],
    ),
    conversation(
      {
        id: "c-jorge",
        phone_number: "+1 305 555 0193",
        guardian: { id: "g-jorge", name: "Jorge Medina" },
        status: "human",
        taken_over_by: me,
        taken_over_at: "2026-10-11T10:04:00-04:00",
        is_window_open: false,
      },
      threads["c-jorge"],
    ),
    conversation(
      {
        id: "c-ricardo",
        phone_number: "+1 786 555 0107",
        guardian: { id: "g-ricardo", name: "Ricardo Torres" },
        status: "human",
        taken_over_by: colleague,
        taken_over_at: "2026-10-13T07:45:00-04:00",
        language: "es",
      },
      threads["c-ricardo"],
    ),
    conversation(
      {
        id: "c-new",
        phone_number: "+1 786 555 0199",
        guardian: null,
        language: null,
      },
      threads["c-new"],
    ),
    conversation(
      {
        id: "c-monica",
        phone_number: "+1 305 555 0187",
        guardian: { id: "g-monica", name: "Mónica Herrera" },
        language: "es",
        is_window_open: false,
      },
      threads["c-monica"],
    ),
  ];

  return { conversations, messages: threads };
}

// What GET /api/conversations would send for one row.
export function toSummary(
  read: ConversationRead,
  thread: MessageRead[],
): ConversationSummary {
  const last = thread[thread.length - 1];
  const lastClientAt = read.last_client_message_at;
  const isUnread =
    lastClientAt !== null &&
    (read.last_read_at === null || read.last_read_at < lastClientAt);
  return {
    id: read.id,
    phone_number: read.phone_number,
    guardian: read.guardian,
    status: read.status,
    taken_over_by: read.taken_over_by,
    last_message_at: read.last_message_at,
    last_message_preview: last?.body ?? null,
    unread: isUnread,
    flag_reason: read.flag_reason,
  };
}

export function buildCounts(summaries: ConversationSummary[]): CountsRead {
  return {
    needs_attention: summaries.filter((chat) => chat.flag_reason).length,
    // Admin vs Manager differ here; Chats reads only the two chat counts.
    time_off_pending: 2,
    children_awaiting_evaluation: 3,
    bookings_to_sort_out: 2,
    unread_chats: summaries.filter((chat) => chat.unread).length,
  };
}
