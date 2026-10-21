import type { Role } from "@/lib/auth/auth";

export type WelcomeCopy = { title: string; body: string };

const TITLE = "Welcome to TutorLink";

const ADMIN_COPY: WelcomeCopy = {
  title: TITLE,
  body: "Home shows what needs you today: chats, Bookings and Time off waiting in To do. Families, Staff and Settings are in the menu.",
};

// What each role's landing page is for and where the main things live. English only (Staff copy).
export const WELCOME_COPY: Record<Role, WelcomeCopy> = {
  admin: ADMIN_COPY,
  developer: ADMIN_COPY,
  manager: {
    title: TITLE,
    body: "Home shows the chats and Bookings waiting in To do. Your own Bookings are under Bookings with Mine on, and your Availability is on your Profile.",
  },
  tutor: {
    title: TITLE,
    body: "My sessions lists your coming Sessions, with each Child’s notes. Set when you can work in My availability, and ask for Time off under Time off.",
  },
};
