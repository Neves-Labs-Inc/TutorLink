// Business time zones as people say them. The zone never changes once
// Bookings exist, so the page only ever reads it.
const ZONE_NAMES: Readonly<Record<string, string>> = {
  "America/New_York": "Eastern Time (New York)",
  "America/Chicago": "Central Time (Chicago)",
  "America/Denver": "Mountain Time (Denver)",
  "America/Phoenix": "Arizona Time (Phoenix)",
  "America/Los_Angeles": "Pacific Time (Los Angeles)",
  "America/Anchorage": "Alaska Time (Anchorage)",
  "Pacific/Honolulu": "Hawaii Time (Honolulu)",
};

// A zone outside the list reads as its city: "Europe/Lisbon" → "Lisbon".
export function getTimeZoneName(zone: string): string {
  const city = zone.split("/").pop()?.replaceAll("_", " ") ?? zone;
  return ZONE_NAMES[zone] ?? city;
}
