import { describe, expect, it } from "vitest";
import { getNav, getNavIdForPath } from "@/components/kit/shell/nav";
import type { CountsRead, NavItem, NavRole } from "@/components/kit/shell/nav";

const NO_COUNTS: CountsRead = {
  needs_attention: 0,
  time_off_pending: 0,
  children_awaiting_evaluation: 0,
  bookings_to_sort_out: 0,
  unread_chats: 0,
};

const SOME_COUNTS: CountsRead = {
  needs_attention: 9,
  time_off_pending: 4,
  children_awaiting_evaluation: 2,
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
  ["Home", "/dashboard"],
  ["Bookings", "/bookings"],
  ["Chats", "/chats"],
  ["Families", "/children"],
  ["Staff", "/tutors"],
  ["Settings", "/settings"],
];

describe("getNav", () => {
  it.each<NavRole>(["admin", "developer"])(
    "gives %s the full office nav in order, without Time off",
    (role) => {
      expect(getLinks(getNav(role))).toEqual(ADMIN_LINKS);
    },
  );

  it("gives a manager the office nav without Settings", () => {
    expect(getLinks(getNav("manager"))).toEqual(ADMIN_LINKS.slice(0, 5));
  });

  it("gives a tutor My sessions, My availability and Time off", () => {
    expect(getLinks(getNav("tutor"))).toEqual([
      ["My sessions", "/sessions"],
      ["My availability", "/schedule"],
      ["Time off", "/time-off"],
    ]);
  });

  it("keeps office Time off for the prototypes that ask for it", () => {
    const labels = getNav("admin", { hasOfficeTimeOff: true }).map(
      (item) => item.label,
    );
    expect(labels).toContain("Time off");
  });

  it("gives no badges while counts are loading", () => {
    expect(getBadges(getNav("admin", { counts: null }))).toEqual({});
  });

  it("gives no badges when every count is zero", () => {
    const items = getNav("admin", {
      counts: NO_COUNTS,
      hasOfficeTimeOff: true,
    });
    expect(getBadges(items)).toEqual({});
  });

  it("puts the counts on Bookings, Chats and Time off", () => {
    const items = getNav("admin", {
      counts: SOME_COUNTS,
      hasOfficeTimeOff: true,
    });
    expect(getBadges(items)).toEqual({
      Bookings: { count: 5, label: "to sort out", tone: "pink" },
      Chats: { count: 7, label: "unread", tone: "primary" },
      "Time off": { count: 4, label: "to review", tone: "pink" },
    });
  });

  it("gives Time off no badge when its count is null", () => {
    const items = getNav("manager", {
      counts: { ...SOME_COUNTS, time_off_pending: null },
      hasOfficeTimeOff: true,
    });
    expect(Object.keys(getBadges(items))).toEqual(["Bookings", "Chats"]);
  });
});

describe("getNavIdForPath", () => {
  it.each([
    ["/dashboard", "home"],
    ["/bookings", "bookings"],
    ["/chats", "chats"],
    ["/chats/c-1", "chats"],
    ["/reminders", "chats"],
    ["/children", "accounts"],
    ["/children/k-1", "accounts"],
    ["/guardians", "accounts"],
    ["/guardians/g-1", "accounts"],
    ["/tutors", "staff"],
    ["/tutors/t-1", "staff"],
    ["/users", "staff"],
    ["/settings", "settings"],
    ["/sessions", "my-sessions"],
    ["/schedule", "my-availability"],
    ["/time-off", "time-off"],
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
