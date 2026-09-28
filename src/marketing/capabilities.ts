/**
 * The public honesty line — the one place the site says what Paige does today and what is in
 * build. Grounded 2026-09-28 in docs/PAIGE-MASTER-PROJECT-REFERENCE.md §4/§5, the Solo
 * functional inventory and the code ("works today" = deployed, reachable by a Solo owner and
 * traced end to end; no surface is yet customer-release-proven). Change a row here only when that
 * record changes — every page that shows capabilities reads from this list, so the site cannot
 * say two different things.
 *
 * Deliberately NOT claimed today: running actions inside MCP-connected tools (gateway execution is
 * switched off), publishing or scheduling social posts (refused server-side), marketing/campaign
 * analytics (not connected), Studio image generation (one successful production run on
 * 2026-09-13; unproven since), a visual page editor, inbox reading, credentialed browsing.
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

export type CapabilityGroup = { id: string; name: string; lanes: CapabilityLane[] };

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    id: "runs",
    name: "She runs the work",
    lanes: [
      {
        id: "email",
        name: "Email & follow-ups",
        promise: "Replies and follow-ups, written in your voice.",
        items: [
          { text: "Drafts replies and follow-ups in your brand voice", state: "live" },
          { text: "Sends them when you approve", state: "live" },
          { text: "Reads your inbox directly", state: "build" },
        ],
      },
      {
        id: "documents",
        name: "Documents",
        promise: "Proposals, offers and letters, drafted from what she knows.",
        items: [
          { text: "Drafts proposals, offers and letters", state: "live" },
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
        promise: "Posts drafted in your voice, ready when you are.",
        items: [
          { text: "Drafts posts and captions, ready to copy", state: "live" },
          { text: "Publishes and schedules for you", state: "build" },
        ],
      },
    ],
  },
  {
    id: "builds",
    name: "She builds",
    lanes: [
      {
        id: "studio",
        name: "Vibe Studio",
        promise: "Landing pages and funnels, described in a sentence, live on a link.",
        items: [
          { text: "Builds landing pages and funnels from your brief", state: "live" },
          { text: "Adds the forms that capture your leads", state: "live" },
          { text: "Publishes them to a live link when you say so", state: "live" },
          { text: "Designs images for them", state: "build" },
          { text: "Lets you edit them on the page itself", state: "build" },
        ],
      },
    ],
  },
  {
    id: "thinks",
    name: "She thinks it through",
    lanes: [
      {
        id: "strategy",
        name: "Strategy & planning",
        promise: "Growth advice grounded in your business, and a plan to act on it.",
        items: [
          { text: "Advises on growth using your setup, pipeline and knowledge", state: "live" },
          { text: "Keeps your Game Plan of strategic plays and next steps", state: "live" },
          { text: "Builds week-to-year plans with milestones and reminders", state: "live" },
          { text: "Researches the web and cites her sources", state: "live" },
        ],
      },
      {
        id: "analytics",
        name: "Analytics",
        promise: "The numbers behind the business, read for you.",
        items: [
          { text: "Reads your sales funnel from your own pipeline", state: "live" },
          { text: "Analyzes your marketing and campaigns", state: "build" },
          { text: "Tracks profit and retention", state: "build" },
        ],
      },
    ],
  },
  {
    id: "connects",
    name: "She connects your tools",
    lanes: [
      {
        id: "integrations",
        name: "Integrations & automations",
        promise: "Your tools talking to each other, with Paige in the middle.",
        items: [
          { text: "Connects your Google Calendar and sending email", state: "live" },
          { text: "Builds and runs your n8n workflows, with your approval", state: "live" },
          { text: "Turns form submissions into contacts, deals and team alerts", state: "live" },
          { text: "Connects your tools' MCP servers", state: "live" },
          { text: "Takes actions inside those connected tools", state: "build" },
        ],
      },
      {
        id: "browser",
        name: "Portals",
        promise: "The admin sites nobody wants to log into.",
        items: [{ text: "Works vendor portals under your own login, while you watch", state: "build" }],
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
      {
        id: "marketplace",
        name: "Marketplace",
        promise: "New skills for the way your business works.",
        items: [
          { text: "Browse the catalogue", state: "live" },
          { text: "Install skills and add-ons", state: "build" },
        ],
      },
    ],
  },
];

/** A lane is lit when anything in it works today. Items always carry their own state in words. */
export const laneIsLive = (lane: CapabilityLane) => lane.items.some((i) => i.state === "live");
