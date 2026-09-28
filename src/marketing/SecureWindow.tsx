import { Mark } from "./Mark";

/**
 * The secure browser moment — marked as in build, honestly. Paige works inside a window the owner
 * can watch, signed in with the owner's own login, and the owner can take over at any time. The
 * portal is a fictional, labelled illustration; the fields fill on a CSS loop that stops under
 * reduced motion (showing the filled state).
 */
export function SecureWindow() {
  return (
    <figure className="pa-window">
      <p className="pa-sr">
        Illustration of a feature in build: Paige filling in a form on a supplier portal inside a
        secure window, signed in with your own login, while you watch and can take over.
      </p>
      <div className="pa-window__frame" aria-hidden="true">
        <div className="pa-window__chrome">
          <span className="pa-window__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="pa-window__address">
            <svg viewBox="0 0 16 16" className="pa-window__lock">
              <path d="M4.5 7V5.2a3.5 3.5 0 0 1 7 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor" />
            </svg>
            supplier-portal.example
          </span>
        </div>
        <div className="pa-window__session">
          <span className="pa-window__you">Signed in with your own login</span>
          <span className="pa-window__watch">You're watching</span>
          <span className="pa-window__take">Take over</span>
        </div>
        <div className="pa-window__page">
          <p className="pa-window__title">Expense claim</p>
          <div className="pa-window__field" style={{ ["--d" as string]: "0" }}>
            <span>Invoice number</span>
            <b>INV-2291</b>
          </div>
          <div className="pa-window__field" style={{ ["--d" as string]: "1" }}>
            <span>Amount</span>
            <b>$1,240.00</b>
          </div>
          <div className="pa-window__field" style={{ ["--d" as string]: "2" }}>
            <span>Receipt</span>
            <b>receipt-march.pdf</b>
          </div>
          <div className="pa-window__submit" style={{ ["--d" as string]: "3" }}>
            Waiting for your go-ahead to submit
          </div>
          <span className="pa-window__presence">
            <Mark state="spectral" size={18} />
          </span>
        </div>
      </div>
      <figcaption className="pa-window__caption">
        <span className="pa-state pa-state--build">In build</span>
        <span>Illustration. The portal, the fields and the figures are made up.</span>
      </figcaption>
    </figure>
  );
}
