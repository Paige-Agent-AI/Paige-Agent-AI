import { CAPABILITY_LANES, laneIsLive } from "./capabilities";

/**
 * The capability map as a score: one stave per lane. What works today is struck — lit, fully
 * set; what is in build is present as a ghost and says so in words. Nothing is hidden and nothing
 * is claimed early. Colour is never the only signal: every item carries its state as text.
 */
export function CapabilityScore({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`pa-score${compact ? " pa-score--compact" : ""}`}>
      <div className="pa-score__legend" aria-hidden="true">
        <span className="pa-state pa-state--live">Works today</span>
        <span className="pa-state pa-state--build">In build</span>
      </div>
      <ul className="pa-score__lanes">
        {CAPABILITY_LANES.map((lane) => {
          const lit = laneIsLive(lane);
          return (
            <li key={lane.id} className="pa-lane" data-lit={lit}>
              <div className="pa-lane__head">
                <h3 className="pa-lane__name">{lane.name}</h3>
                <p className="pa-lane__promise">{lane.promise}</p>
              </div>
              <div className="pa-lane__stave">
                <span className="pa-staff" aria-hidden="true" />
                <ul className="pa-lane__items">
                  {lane.items.map((item) => (
                    <li key={item.text} className="pa-note" data-state={item.state}>
                      <span className="pa-note__head" aria-hidden="true" />
                      <span className="pa-note__text">{item.text}</span>
                      <span className={`pa-state pa-state--${item.state} pa-note__state`}>
                        {item.state === "live" ? "Works today" : "In build"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
