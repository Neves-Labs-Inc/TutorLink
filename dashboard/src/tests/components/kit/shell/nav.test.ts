import { describe, expect, it } from "vitest";
import { getNav, getNavIdForPath } from "@/components/kit/shell/nav";
import type { CountsRead, NavItem, NavRole } from "@/components/kit/shell/nav";

const NO_COUNTS: CountsRead = {
  needs_attention: 0,
  time_off_pending: 0,
  children_awaiting_evaluation: 0,
  children_needing_tutor: 0,
  bookings_to_sort_out: 0,
  unread_chats: 0,
};

const SOME_COUNTS: CountsRead = {
  needs_attention: 9,
  time_off_pending: 4,
  children_awaiting_evaluation: 2,
  children_needing_tutor: 4,
  bookings_to_sort_out: 3,
  unread_chats: 7,
};

function getLinks(items: NavItem[]): [string, string][] {
  return items.map((item) => [item.label, item.path]);
}

function getBadges(items: NavItem[]): Record<string, unknown> {
  return Object.fromEntries(
    items.filter((item) => item.badge).map((item) => [item.label, item.badge]),
  );
}

const ADMIN_LINKS: [string, string][] = [
  ["Home", "/home"],
  ["Bookings", "/bookings"],
  ["Chats", "/chats"],
  ["Families", "/families"],
  ["Staff", "/staff"],
  ["Time off", "/time-off"],
  ["Settings", "/settings"],
];

describe("getNav", () => {
  it.each<NavRole>(["admin", "developer"])(
    "gives %s the full office nav in order, Time off included",
    (role) => {
      expect(getLinks(getNav(role))).toEqual(ADMIN_LINKS);
    },
  );

  it("gives a manager the office nav without Settings", () => {
    expect(getLinks(getNav("manager"))).toEqual(ADMIN_LINKS.slice(0, 6));
  });

  it("gives a tutor My sessions, My availability and Time off", () => {
    expect(getLinks(getNav("tutor"))).toEqual([
      ["My sessions", "/sessions"],
      ["My availability", "/availability"],
      ["Time off", "/time-off"],
    ]);
  });

  it("opens the same Time off path for every role", () => {
    const paths = (["admin", "developer", "manager", "tutor"] as NavRole[]).map(
      (role) => getNav(role).find((item) => item.id === "time-off")?.path,
    );
    expect(paths).toEqual(["/time-off", "/time-off", "/time-off", "/time-off"]);
  });

  it("gives no badges while counts are loading", () => {
    expect(getBadges(getNav("admin", { counts: null }))).toEqual({});
  });

  it("gives no badges when every count is zero", () => {
    const items = getNav("admin", {
      counts: NO_COUNTS,
    });
    expect(getBadges(items)).toEqual({});
  });

  it("puts the counts on Bookings, Chats and Time off", () => {
    const items = getNav("admin", {
      counts: SOME_COUNTS,
    });
    expect(getBadges(items)).toEqual({
      Bookings: { count: 9, label: "to sort out", tone: "pink" },
      Chats: { count: 7, label: "unread", tone: "primary" },
      "Time off": { count: 4, label: "to review", tone: "pink" },
    });
  });

  it("sums sort-out Bookings, Evaluations and Children needing a Tutor on Bookings", () => {
    const counts = { ...NO_COUNTS, children_needing_tutor: 4 };
    const items = getNav("admin", { counts });
    expect(getBadges(items)).toEqual({
      Bookings: { count: 4, label: "to sort out", tone: "pink" },
    });
  });

  it("gives Time off no badge when its count is null", () => {
    const items = getNav("manager", {
      counts: { ...SOME_COUNTS, time_off_pending: null },
    });
    expect(Object.keys(getBadges(items))).toEqual(["Bookings", "Chats"]);
  });
});

describe("getNavIdForPath", () => {
  it.each([
    ["/home", "home"],
    ["/dashboard", "home"],
    ["/bookings", "bookings"],
    ["/chats", "chats"],
    ["/chats/c-1", "chats"],
    ["/reminders", "chats"],
    ["/families", "accounts"],
    ["/families/g-1", "accounts"],
    ["/children", "accounts"],
    ["/children/k-1", "accounts"],
    ["/guardians", "accounts"],
    ["/guardians/g-1", "accounts"],
    ["/staff", "staff"],
    ["/staff/u-1", "staff"],
    ["/tutors", "staff"],
    ["/tutors/t-1", "staff"],
    ["/users", "staff"],
    ["/settings", "settings"],
    ["/sessions", "my-sessions"],
    ["/schedule", "my-availability"],
    ["/availability", "my-availability"],
    ["/time-off", "time-off"],
    ["/time-off/to-1", "time-off"],
    ["/profile", "profile"],
    ["/Children/k-1", "accounts"],
  ])("maps %s to %s", (path, expected) => {
    expect(getNavIdForPath(path)).toBe(expected);
  });

  it.each(["/", "/nowhere", "/dashboards", "/prototype/home"])(
    "maps %s to no item",
    (path) => {
      expect(getNavIdForPath(path)).toBeNull();
    },
  );
});
