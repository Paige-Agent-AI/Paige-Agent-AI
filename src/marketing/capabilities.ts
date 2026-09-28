/**
 * The public honesty line — the one place the site says what Paige does today and what is in
 * build. Grounded 2026-09-28 in docs/PAIGE-MASTER-PROJECT-REFERENCE.md §4/§5 and the binding
 * ledger ("live" = deployed and usable by a Solo customer today; no surface is yet
 * customer-release-proven). Change a row here only when that record changes — every page that
 * shows capabilities reads from this list, so the site cannot say two different things.
 *
 * §2: no funding/credit lane on the public site, ever.
 */
export type CapabilityState = "live" | "build";

export type CapabilityItem = { text: string; state: CapabilityState };

export type CapabilityLane = {
  id: string;
  name: string;
  /** One line in the owner's terms: what this lane does for the business. */
  promise: string;
  items: CapabilityItem[];
};

export const CAPABILITY_LANES: CapabilityLane[] = [
  {
    id: "email",
    name: "Email",
    promise: "Replies and follow-ups, written in your voice.",
    items: [
      { text: "Drafts replies and follow-ups in your brand voice", state: "live" },
      { text: "Sends only when you approve", state: "live" },
      { text: "Reads your inbox directly", state: "build" },
    ],
  },
  {
    id: "documents",
    name: "Documents",
    promise: "Proposals, offers and letters, drafted from what she knows.",
    items: [
      { text: "Drafts proposals, offers and letters in chat", state: "live" },
      { text: "Exports finished PDFs", state: "build" },
      { text: "Collects signatures", state: "build" },
    ],
  },
  {
    id: "clients",
    name: "Clients & calendar",
    promise: "Every client, note and meeting kept in order.",
    items: [
      { text: "Adds and updates clients, notes and tasks", state: "live" },
      { text: "Runs your booking page and books meetings", state: "live" },
      { text: "Sends your booking link", state: "live" },
    ],
  },
  {
    id: "social",
    name: "Social",
    promise: "Posts written for the week, in your voice.",
    items: [
      { text: "Drafts posts, ready to copy", state: "live" },
      { text: "Publishes and schedules for you", state: "build" },
    ],
  },
  {
    id: "browser",
    name: "Secure browser",
    promise: "The portals and admin sites nobody wants to log into.",
    items: [
      { text: "Researches public web pages", state: "live" },
      { text: "Works vendor portals under your own login, while you watch", state: "build" },
    ],
  },
  {
    id: "marketplace",
    name: "Marketplace",
    promise: "New skills for the way your business works.",
    items: [
      { text: "Browse the catalogue", state: "live" },
      { text: "Install skills and add-ons", state: "build" },
    ],
  },
  {
    id: "payments",
    name: "Payments & invoicing",
    promise: "Invoices out and payments chased, through your own processor.",
    items: [
      { text: "Invoices through your own payment processor", state: "build" },
      { text: "Chases overdue payments", state: "build" },
    ],
  },
];

/** A lane is lit when anything in it works today. */
export const laneIsLive = (lane: CapabilityLane) => lane.items.some((i) => i.state === "live");
