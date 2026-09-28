import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import "./site.css";
import { Lockup } from "./Mark";
import { FOOTER_NAV, PRIMARY_NAV, loginHref, trialHref } from "./siteLinks";

export function ArrowIcon({ className = "pa-arrow" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <path d="M3 8h9.5M8.5 3.5 13 8l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {open ? (
        <path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      ) : (
        <path d="M3 7h14M3 13h14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** The trial CTA. A real anchor (no JS required) to the unchanged signup seam. */
export function TrialButton({ children = "Start your 30-day trial", size }: { children?: ReactNode; size?: "sm" }) {
  return (
    <a href={trialHref()} className={`pa-btn pa-btn--act${size === "sm" ? " pa-btn--sm" : ""}`}>
      {children}
      <ArrowIcon />
    </a>
  );
}

function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const sheetId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [location.pathname]);

  // The sheet belongs to narrow screens: widening past the desktop breakpoint closes it.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header className="pa-header" data-scrolled={scrolled || open}>
      <div className="pa-wrap pa-header__bar">
        <Link to="/" className="pa-brand" aria-label="Paige Agent AI, home">
          <Lockup size={30} />
        </Link>
        <nav className="pa-nav" aria-label="Primary">
          {PRIMARY_NAV.map((l) => (
            <NavLink key={l.to} to={l.to}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="pa-header__actions">
          <a href={loginHref()} className="pa-btn pa-btn--quiet pa-btn--sm pa-header__login">
            Log in
          </a>
          <a href={trialHref()} className="pa-btn pa-btn--act pa-btn--sm">
            Hire Paige
          </a>
          <button
            ref={toggleRef}
            type="button"
            className="pa-menu-btn"
            aria-expanded={open}
            aria-controls={open ? sheetId : undefined}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <MenuIcon open={open} />
          </button>
        </div>
      </div>
      {open ? (
        <nav id={sheetId} className="pa-sheet" aria-label="Menu">
          {[{ label: "Home", to: "/" }, ...PRIMARY_NAV].map((l) => (
            <Link key={l.to} to={l.to} className="pa-sheet__link" onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <div className="pa-sheet__ctas">
            <a href={trialHref()} className="pa-btn pa-btn--act">
              Start your 30-day trial
              <ArrowIcon />
            </a>
            <a href={loginHref()} className="pa-btn pa-btn--line">
              Log in
            </a>
          </div>
        </nav>
      ) : null}
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="pa-footer">
      <div className="pa-wrap">
        <div className="pa-footer__grid">
          <div className="pa-footer__brand">
            <Lockup size={28} />
            <p>The command layer for modern business.</p>
          </div>
          <div className="pa-footer__cols">
            {FOOTER_NAV.map((col) => (
              <div key={col.heading}>
                <h2>{col.heading}</h2>
                <ul>
                  {col.links.map((l) => (
                    <li key={l.to}>
                      <Link to={l.to}>{l.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="pa-footer__base">
          <span>© {new Date().getFullYear()} Paige Agent AI Inc.</span>
          <span>Paige Solo: 30-day trial, then $74.50/month.</span>
        </div>
      </div>
    </footer>
  );
}

/**
 * Scroll reveals, one observer for the whole site: any element marked `data-reveal` gets
 * `data-in` the first time it enters the viewport. The site only opts into hiding-until-seen
 * (`data-motion="on"`) once this runs and motion is allowed, so without script or with reduced
 * motion every section is simply there.
 */
function useReveals(root: RefObject<HTMLDivElement>) {
  const location = useLocation();
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.dataset.motion = "on";
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = "true";
          io.unobserve(e.target);
        }
      },
      // Fires when an element's top edge is 12% into the viewport, however tall it is, so a long
      // section never sits blank waiting for a fraction of itself to show.
      { rootMargin: "0px 0px -12% 0px", threshold: 0 },
    );
    el.querySelectorAll<HTMLElement>("[data-reveal]:not([data-in])").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [root, location.pathname]);
}

/** The public site's one frame: skip link, header, main landmark, footer. */
export function SiteShell({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  return (
    <div className="pa-site" ref={root}>
      <a href="#main" className="pa-skip">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
