import { PageHead } from "@/components/seo/PageHead";
import { SiteShell, TrialButton, ArrowIcon } from "@/marketing/SiteShell";
import { HeroMeasure } from "@/marketing/HeroMeasure";
import { StackCalculator } from "@/marketing/StackCalculator";
import { CapabilityScore } from "@/marketing/CapabilityScore";
import { SecureWindow } from "@/marketing/SecureWindow";
import { WeekScore } from "@/marketing/WeekScore";
import { Mark } from "@/marketing/Mark";
import { Accent, CommandHeading, CommandSequence } from "@/marketing/Command";
import { pricingHref } from "@/marketing/siteLinks";
import "@/marketing/home.css";

/**
 * PaigeHome (route "/") — the public front door. Paige is positioned as an AI chief operating
 * officer: she does the work, the owner decides what goes out. Every capability shown comes from
 * `@/marketing/capabilities` (the single honesty line); every illustration is labelled as one.
 * The two acts are the unchanged enrollment seams (`trialHref` → Solo signup, `loginHref` → /auth).
 */

const SEAMS = [
  { gap: "The lead", miss: "that never got a proposal." },
  { gap: "The proposal", miss: "that never got a follow-up." },
  { gap: "The client", miss: "who signed and was never onboarded." },
];

/** The close: Paige works through the commands an owner would give her, and lands on the last. */
const CLOSE_COMMANDS = ["Run follow-ups", "Run the launch", "Run everything"];

const OUTCOMES = [
  "Replies, follow-ups and proposals, written in your voice",
  "Landing pages and funnels, built and published on your say",
  "Growth advice, a Game Plan, and plans that keep you moving",
  "Clients, calendar and booking page kept in order",
  "Your calendar, email and n8n workflows connected",
];

export default function PaigeHome() {
  return (
    <SiteShell>
      <PageHead
        title="Paige — the AI chief operating officer for client-service businesses"
        description="Paige is the AI chief operating officer for client-service businesses. She does the work between your client meetings. Start Paige Solo free for 30 days, then $74.50/month."
        path="/"
      />

      {/* Hero: the thesis, and the one loop that proves it. */}
      <section className="pa-hero" aria-labelledby="hero-title">
        {/* The stage: a slow champagne light over deep blue, a fine grain, and the staff lines
            running through it. Purely atmospheric, still under reduced motion. */}
        <div className="pa-atmos" aria-hidden="true">
          <span className="pa-atmos__light pa-atmos__light--a" />
          <span className="pa-atmos__light pa-atmos__light--b" />
          <span className="pa-atmos__light pa-atmos__light--c" />
          <span className="pa-atmos__grain" />
        </div>
        <HeroMeasure
          honest="Today you hand Paige the message in chat. Reading your inbox directly is in build."
          title={
            <CommandHeading
              id="hero-title"
              className="pa-display"
              parts={["Paige is your AI chief operating ", { accent: "officer." }]}
            />
          }
        >
          <p className="pa-hero__beat">
            The replies, the proposals, the landing pages, the plan for the quarter. Done in your voice, between
            your client meetings.
          </p>
          <div className="pa-hero__acts">
            <TrialButton />
            <a href="#today" className="pa-btn pa-btn--line">
              See what she does today
            </a>
          </div>
          <p className="pa-small pa-hero__price">
            Free for 30 days, then $74.50 a month. Cancel before your first renewal and you pay nothing.
          </p>
        </HeroMeasure>
      </section>

      {/* Capacity: a COO runs the work, and she has a team. */}
      <section className="pa-section pa-capacity" aria-labelledby="capacity-title">
        <div className="pa-wrap pa-capacity__grid">
          <h2 id="capacity-title" className="pa-h2" data-reveal="rise">
            A chief operating officer doesn’t do everything herself. She <Accent>runs</Accent> it.
          </h2>
          <div className="pa-capacity__body">
            <p className="pa-lead">
              You tell Paige what matters. She takes the work between your client meetings off your hands and brings it
              back done: the reply, the proposal draft, the landing page, the plan for the quarter, the meeting on your
              calendar.
            </p>
            <ol className="pa-capacity__line">
              <li data-state="live">
                <span className="pa-state pa-state--live">Works today</span>
                <p>Paige does the work herself, in one conversation with you.</p>
              </li>
              <li data-state="build">
                <span className="pa-state pa-state--build">In build</span>
                <p>
                  She puts a team on it. One specialist drafts your follow-ups while another prepares the proposal, and each
                  reports back to her, and she to you.
                </p>
              </li>
            </ol>
            <details className="pa-disclose">
              <summary>How her team will work</summary>
              <div className="pa-disclose__body">
                <p>
                  Paige will hand each specialist one bounded task and only the context that task needs. Specialists will
                  draft, look things up and operate the tools you’ve connected, then report back to Paige, who checks the
                  work before it reaches you. None of them will be able to send anything on your behalf.
                </p>
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* The seam: sell the gaps, not the seats. */}
      <section className="pa-section pa-seam" aria-labelledby="seam-title">
        <div className="pa-wrap">
          <h2 id="seam-title" className="pa-h2 pa-seam__title" data-reveal="rise">
            The tools aren’t the problem. The <Accent>gaps</Accent> between them are.
          </h2>
          <ul className="pa-seam__list" data-reveal="seam">
            {SEAMS.map((s) => (
              <li key={s.gap}>
                <span className="pa-staff" aria-hidden="true" />
                <p>
                  <strong>{s.gap}</strong> {s.miss}
                </p>
              </li>
            ))}
          </ul>
          <p className="pa-seam__turn" data-reveal="rise">
            Tools don’t do work. A person does. <span>Paige is the one who works the gaps.</span>
          </p>
        </div>
      </section>

      {/* Stack calculator: the visitor makes the argument with their own numbers. */}
      <section className="pa-section pa-stack" aria-labelledby="stack-title">
        <div className="pa-wrap pa-stack__grid">
          <div className="pa-stack__intro">
            <h2 id="stack-title" className="pa-h2" data-reveal="rise">
              Add up what you pay for the seats.
            </h2>
            <p className="pa-copy">
              Every tool you pay for holds a piece of the business. None of them moves the work from one to the next. Put
              in your own numbers and see them next to Paige.
            </p>
          </div>
          <StackCalculator />
        </div>
      </section>

      {/* Capability map: the whole scope, and the truth, in one gesture. */}
      <section className="pa-section pa-map" id="today" aria-labelledby="map-title">
        <div className="pa-wrap">
          <div className="pa-map__head">
            <h2 id="map-title" className="pa-h2" data-reveal="rise">
              What she does today. What’s <Accent>coming next.</Accent>
            </h2>
            <p className="pa-copy">
              Every item marked “Works today” is live for Solo customers now. Everything marked “In build” is being
              built, and it’s on this map so you can see where Paige is going.
            </p>
          </div>
          <CapabilityScore />
        </div>
      </section>

      {/* The secure window: the "took it off my hands" moment, honestly marked. */}
      <section className="pa-section pa-coming" aria-labelledby="window-title">
        <div className="pa-wrap pa-coming__grid">
          <div className="pa-coming__copy">
            <h2 id="window-title" className="pa-h2" data-reveal="rise">
              Coming next: the portals you dread, handled while you watch.
            </h2>
            <p className="pa-copy">
              Supplier portals, admin sites, the renewal form nobody wants to fill in. Paige will work them inside a secure
              window, signed in with your own login, with you watching. You can take over at any moment.
            </p>
          </div>
          <SecureWindow />
        </div>
      </section>

      {/* Time given back. */}
      <section className="pa-section pa-time" aria-labelledby="time-title">
        <div className="pa-wrap">
          <div className="pa-time__head">
            <h2 id="time-title" className="pa-h2" data-reveal="rise">
              Your week, with the gaps worked.
            </h2>
            <p className="pa-copy">The client work stays yours. The work between the meetings is what Paige takes off your hands.</p>
          </div>
          <WeekScore />
        </div>
      </section>

      {/* The trust promise — said once. */}
      <section className="pa-section pa-promise" aria-labelledby="promise-title">
        <div className="pa-wrap pa-promise__inner">
          <Mark state="spectral" size={40} />
          <h2 id="promise-title" className="pa-h2" data-reveal="rise">
            You decide what she does <Accent>on her own.</Accent>
          </h2>
          <p className="pa-lead">
            Paige drafts, researches, plans and builds for you. In her Trust Compass you choose which everyday jobs
            she handles by herself. Anything she sends to a customer, publishes, or changes in one of your tools
            waits for your yes. That isn’t unfinished work. It’s the control that keeps it your business.
          </p>
        </div>
      </section>

      {/* Pricing, in outcomes a person recognizes. */}
      <section className="pa-section pa-plan" id="pricing" aria-labelledby="plan-title">
        <div className="pa-wrap pa-plan__grid">
          <div>
            <h2 id="plan-title" className="pa-h2" data-reveal="rise">
              One plan. One operator.
            </h2>
            <p className="pa-copy">
              Paige Solo is for the owner running a client-service business. Agency and team accounts are coming.
            </p>
          </div>
          <div className="pa-plan__card pa-stacked" data-reveal="rise">
            <div className="pa-plan__top">
              <p className="pa-h3">Paige Solo</p>
              <p className="pa-plan__price">
                <span className="pa-num">$74.50</span>
                <span className="pa-small">per month, after 30 days free</span>
              </p>
            </div>
            <ul className="pa-plan__list">
              {OUTCOMES.map((o) => (
                <li key={o}>
                  <span className="pa-plan__tick" aria-hidden="true" />
                  {o}
                </li>
              ))}
            </ul>
            <a href={pricingHref()} className="pa-btn pa-btn--act">
              Start your 30-day trial
              <ArrowIcon />
            </a>
            <p className="pa-small">
              Card collected at checkout. Cancel before your first renewal and you pay nothing.
            </p>
          </div>
        </div>
      </section>

      {/* Close: the mark's payoff. */}
      <section className="pa-section pa-close" aria-labelledby="close-title">
        <div className="pa-wrap pa-close__inner">
          <CommandSequence
            id="close-title"
            className="pa-close__line"
            commands={CLOSE_COMMANDS}
            label="Run everything."
          />
          <p className="pa-lead">Hire the chief operating officer your business has been missing.</p>
          <div className="pa-hero__acts pa-close__acts">
            <TrialButton>Hire Paige, free for 30 days</TrialButton>
            <a href="#pricing" className="pa-btn pa-btn--line">
              See pricing
              <ArrowIcon />
            </a>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
