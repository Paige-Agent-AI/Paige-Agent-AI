import { CAPABILITY_GROUPS, laneIsLive } from "./capabilities";

/**
 * The capability map as a score, in four movements — how a chief operating officer works: she runs
 * the work, builds, thinks it through, and connects the tools. One stave per lane. What works today
 * is struck, lit and fully set; what is in build is present as a ghost and says so in words.
 * Nothing is hidden and nothing is claimed early. Colour is never the only signal.
 */
export function CapabilityScore() {
  let index = 0;
  return (
    <div className="pa-score" data-reveal="score">
      <div className="pa-score__legend" aria-hidden="true">
        <span className="pa-state pa-state--live">Works today</span>
        <span className="pa-state pa-state--build">In build</span>
      </div>
      {CAPABILITY_GROUPS.map((group) => (
        <section key={group.id} className="pa-movement" aria-labelledby={`movement-${group.id}`}>
          <h3 id={`movement-${group.id}`} className="pa-movement__name">
            {group.name}
          </h3>
          <ul className="pa-score__lanes">
            {group.lanes.map((lane) => {
              const lit = laneIsLive(lane);
              const i = index++;
              return (
                <li key={lane.id} className="pa-lane" data-lit={lit} style={{ ["--i" as string]: i }}>
                  <div className="pa-lane__head">
                    <h4 className="pa-lane__name">{lane.name}</h4>
                    <p className="pa-lane__promise">{lane.promise}</p>
                  </div>
                  <div className="pa-lane__stave">
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
        </section>
      ))}
    </div>
  );
}
