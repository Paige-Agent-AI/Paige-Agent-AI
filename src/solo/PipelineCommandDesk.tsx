// @ts-nocheck
import React from "react";
import { PipelineDelete } from "./PipelineDelete";
import { DealClientPicker } from "./deals/DealClientPicker";
import { CrmDealCommandReview } from "./deals/CrmDealCommandReview";
import { X } from "lucide-react";

const fmt = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
};
const outcomeLabel = (value) =>
  ({
    won: "Won",
    lost: "Lost",
    not_fit: "Not a fit",
    closed_without_decision: "Closed without decision",
    reopened: "Reopened",
  })[value] || value;

const activeAutomationFor = (rules, deal, target) =>
  target
    ? (rules || []).find(
        (rule) =>
          rule.isActive &&
          rule.pipelineId === deal.pipelineId &&
          rule.toStageId === target.id &&
          (rule.fromStageId === null || rule.fromStageId === deal.stageId),
      ) || null
    : null;

function DeskDialog({
  title,
  eyebrow,
  children,
  onClose,
  busy = false,
  wide = false,
}) {
  const ref = React.useRef(null),
    closeRef = React.useRef(null),
    onCloseRef = React.useRef(onClose),
    busyRef = React.useRef(busy);
  onCloseRef.current = onClose;
  busyRef.current = busy;
  const titleId = React.useId();
  React.useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(ref.current?.querySelectorAll(
          "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])",
        ) || []),
      ];
      if (!focusable.length) return;
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <>
      <button
        className="pipeline-desk-scrim"
        tabIndex={-1}
        aria-label="Close"
        onClick={() => !busy && onClose()}
      />
      <aside
        ref={ref}
        className={`pipeline-desk-dialog ${wide ? "is-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
      >
        <header>
          <div>
            <h2 id={titleId}>{title}</h2>
            {eyebrow && <p className="pipeline-evidence">{eyebrow}</p>}
          </div>
          <button
            ref={closeRef}
            className="btn btn-s"
            disabled={busy}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {children}
      </aside>
    </>
  );
}

function DealCard({
  deal,
  canManage,
  onOpen,
  onMove,
  onDragStart,
  onKeyDown,
  moving,
}) {
  return (
    <article
      className={`pipeline-desk-card pipeline-card ${moving ? "is-moving" : ""}`}
      draggable={canManage}
      onDragStart={onDragStart}
      onKeyDown={onKeyDown}
      tabIndex={canManage ? 0 : -1}
    >
      <button
        className="pipeline-desk-card-main pipeline-card-open"
        onClick={onOpen}
      >
        <span className="pipeline-desk-card-top">
          <strong>{deal.title}</strong>
          <i aria-hidden="true" />
        </span>
        <span>{deal.clientName}</span>
        <dl>
          <div>
            <dt>Next</dt>
            <dd>{deal.nextAction}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{deal.owner}</dd>
          </div>
        </dl>
        {deal.tags.length > 0 && (
          <span className="pipeline-desk-tags">
            {deal.tags.slice(0, 3).map((tag) => (
              <small key={tag}>{tag}</small>
            ))}
          </span>
        )}
        <small className="pipeline-evidence">
          {deal.source} - {fmt(deal.updatedAt)}
        </small>
      </button>
      {canManage && (
        <button className="pipeline-desk-move" onClick={onMove}>
          Move
        </button>
      )}
    </article>
  );
}

export function PipelineCommandDesk({
  data,
  selectedId,
  setSelectedId,
  folderFilter,
  setFolderFilter,
  onCreatePipeline,
  onManage,
  onFolders,
  focusDealId = null,
  onClearFocus = () => {},
  createRequested = false,
  dealFilter = null,
}) {
  const workspace = data.pipelineWorkspace;
  const activePipelines = workspace.pipelines.filter(
    (item) => item.lifecycleStatus !== "archived",
  );
  const archivedPipelines = workspace.pipelines.filter(
    (item) => item.lifecycleStatus === "archived",
  );
  const visiblePipelines = activePipelines.filter(
    (item) =>
      folderFilter === "all" ||
      (folderFilter === "unfiled"
        ? !item.folderId
        : item.folderId === folderFilter),
  );
  const selected =
    visiblePipelines.find((item) => item.id === selectedId) ||
    visiblePipelines[0] ||
    (folderFilter === "all" ? activePipelines[0] : null);
  const stages = selected
    ? workspace.stages
        .filter(
          (stage) => stage.pipelineId === selected.id && !stage.archivedAt,
        )
        .map((stage) => ({ ...stage, stageType: stage.stageType || "open" }))
        .sort((a, b) => a.orderIndex - b.orderIndex)
    : [];
  const activeStages = stages.filter((stage) => stage.stageType === "open");
  const closingStages = stages.filter((stage) => stage.stageType !== "open");
  const deals = selected
    ? workspace.deals
        .filter((deal) => deal.pipelineId === selected.id && (!dealFilter || dealFilter(deal)))
        .map((deal) => ({
          ...deal,
          tags: deal.tags || [],
          outcomes: deal.outcomes || [],
          notes: deal.notes || "",
        }))
    : [];
  const activeDeals = deals.filter((deal) => deal.status === "open");
  const decidedDeals = deals.filter(
    (deal) =>
      deal.status !== "open" ||
      deal.outcomes.some((item) => item.outcomeType !== "reopened"),
  );
  const [focusedStageId, setFocusedStageId] = React.useState("");
  const [mode, setMode] = React.useState("board");
  const [detail, setDetail] = React.useState(null);
  const [move, setMove] = React.useState(null);
  const [outcome, setOutcome] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [outcomeFilter, setOutcomeFilter] = React.useState("all");
  const [keyboardMove, setKeyboardMove] = React.useState(null);
  const operationRef = React.useRef({
    epoch: 0,
    activeToken: 0,
    keys: new Map(),
  });
  const overlayHistory = React.useRef(false);
  const canTravelHistory =
    typeof navigator === "undefined" ||
    !navigator.userAgent.toLowerCase().includes("jsdom");
  const activeOverlay = outcome
    ? "outcome"
    : move
      ? "move"
      : detail
        ? "detail"
        : mode === "new"
          ? "new"
          : "";
  const hasOverlay = Boolean(activeOverlay);
  React.useEffect(() => {
    const closeFromBack = () => {
      if (!overlayHistory.current) return;
      overlayHistory.current = false;
      if (outcome) setOutcome(null);
      else if (move) setMove(null);
      else if (detail) setDetail(null);
      else if (mode === "new") setMode("board");
    };
    window.addEventListener("popstate", closeFromBack);
    // Deep-linked overlays already own a real route history entry. A second same-URL
    // entry would resurrect the focus query when the close handler navigates away.
    if (hasOverlay && !overlayHistory.current && !focusDealId && !createRequested) {
      window.history.pushState(
        { ...window.history.state, __paigePipelineOverlay: true },
        "",
      );
      overlayHistory.current = true;
    } else if (!hasOverlay && overlayHistory.current) {
      overlayHistory.current = false;
      if (canTravelHistory) window.history.back();
      else
        window.history.replaceState(
          { ...window.history.state, __paigePipelineOverlay: undefined },
          "",
        );
    }
    return () => window.removeEventListener("popstate", closeFromBack);
  }, [
    activeOverlay,
    hasOverlay,
    canTravelHistory,
    outcome,
    move,
    detail,
    mode,
    focusDealId,
    createRequested,
  ]);
  React.useEffect(
    () => () => {
      if (overlayHistory.current) {
        overlayHistory.current = false;
        if (canTravelHistory) window.history.back();
      }
    },
    [canTravelHistory],
  );
  const focusId = activeStages.some((stage) => stage.id === focusedStageId)
    ? focusedStageId
    : activeStages[0]?.id;

  React.useEffect(() => {
    operationRef.current.epoch += 1;
    operationRef.current.activeToken += 1;
    operationRef.current.keys.clear();
    setBusy(false);
    setDetail(null);
    setMove(null);
    setOutcome(null);
    setNotice("");
    setMode("board");
    setFocusedStageId("");
    setKeyboardMove(null);
  }, [data.tenantId, selected?.id]);
  React.useEffect(() => {
    if (createRequested && workspace.canManage && selected?.id && activeStages.length > 0) setMode("new");
  }, [createRequested, workspace.canManage, selected?.id, activeStages.length]);
  React.useEffect(() => {
    if (!focusDealId) return;
    const requested = workspace.deals.find((item) => item.id === focusDealId);
    if (!requested || (dealFilter && !dealFilter(requested))) {
      setDetail(null);
      setNotice("Deal record unavailable in this workspace. Nothing was changed.");
      return;
    }
    if (requested.pipelineId !== selected?.id) {
      setFolderFilter("all");
      setSelectedId(requested.pipelineId);
      return;
    }
    setMode("board");
    setNotice("");
    setDetail(requested);
  }, [focusDealId, workspace.deals, selected?.id, setFolderFilter, setSelectedId, dealFilter]);
  React.useEffect(()=>{if(detail&&dealFilter&&!dealFilter(detail)){setDetail(null);setNotice("Deal excluded by the current filters. Nothing was changed.");}},[dealFilter,detail]);
  const run = async (action) => {
    const epoch = operationRef.current.epoch;
    const signature = JSON.stringify(action);
    const idempotencyKey =
      operationRef.current.keys.get(signature) || crypto.randomUUID();
    operationRef.current.keys.set(signature, idempotencyKey);
    const token = ++operationRef.current.activeToken;
    setBusy(true);
    setNotice("");
    try {
      const result = await data.pipelineAction({ ...action, idempotencyKey });
      if (
        epoch !== operationRef.current.epoch ||
        token !== operationRef.current.activeToken
      )
        return result;
      setNotice(result.message);
      if (result.ok) operationRef.current.keys.delete(signature);
      return result;
    } finally {
      if (
        epoch === operationRef.current.epoch &&
        token === operationRef.current.activeToken
      )
        setBusy(false);
    }
  };
  const askPaige = () =>
    window.dispatchEvent(
      new CustomEvent("paige:open", {
        detail: {
          prompt: `Using the Pipeline catalogue and tenant-safe Pipeline actions, help me operate ${selected ? selected.name + " (" + selected.shortRef + ")" : "this workspace"}. Read current records first. Prepare an editable plan in this composer; do not auto-send, invent facts, bypass stage policy, or claim an action succeeded without a verified result.`,
        },
      }),
    );
  const beginMove = (deal, target, automationReviewed = false) => {
    if (!target || target.id === deal.stageId) return;
    const automationRule = activeAutomationFor(
      workspace.automationRules,
      deal,
      target,
    );
    if (target.stageType !== "open") {
      setOutcome({
        deal,
        outcomeType: target.stageType,
        targetStageId: target.id,
        automationReviewed,
      });
      setMove(null);
      return;
    }
    if (automationRule && !automationReviewed) {
      setMove({ deal, targetStageId: target.id });
      return;
    }
    void (async () => {
      const result = await run({
        type: "move-deal",
        dealId: deal.id,
        targetStageId: target.id,
        expectedVersion: deal.version,
        reason: "Pipeline command desk move",
        automationReviewed,
      });
      if (result?.ok) setMove(null);
    })();
  };
  const onCardKey = (event, deal) => {
    if (event.target !== event.currentTarget) return;
    const currentId =
      keyboardMove?.dealId === deal.id
        ? keyboardMove.targetStageId
        : deal.stageId;
    const index = activeStages.findIndex((stage) => stage.id === currentId);
    if (event.key === " " && workspace.canManage) {
      event.preventDefault();
      if (keyboardMove?.dealId === deal.id) {
        beginMove(deal, activeStages[index]);
        setKeyboardMove(null);
      } else {
        setKeyboardMove({ dealId: deal.id, targetStageId: deal.stageId });
        setNotice(
          deal.title +
            " picked up. Use arrow keys, then Enter or Space to move.",
        );
      }
    } else if (
      keyboardMove?.dealId === deal.id &&
      (event.key === "ArrowRight" || event.key === "ArrowLeft")
    ) {
      event.preventDefault();
      const next = Math.max(
        0,
        Math.min(
          activeStages.length - 1,
          index + (event.key === "ArrowRight" ? 1 : -1),
        ),
      );
      setKeyboardMove({
        dealId: deal.id,
        targetStageId: activeStages[next].id,
      });
      setNotice("Target stage " + activeStages[next].label + ".");
    } else if (keyboardMove?.dealId === deal.id && event.key === "Enter") {
      event.preventDefault();
      beginMove(deal, activeStages[index]);
      setKeyboardMove(null);
    } else if (keyboardMove?.dealId === deal.id && event.key === "Escape") {
      event.preventDefault();
      setKeyboardMove(null);
      setNotice("Move cancelled.");
    } else if (event.key === "Enter" && event.currentTarget === event.target) {
      event.preventDefault();
      setDetail(deal);
    } else if (
      (event.key === "m" || event.key === "M") &&
      workspace.canManage
    ) {
      event.preventDefault();
      setMove({ deal, targetStageId: deal.stageId });
    }
  };
  const recent = activeDeals.filter((deal) => Date.now() - new Date(deal.updatedAt).getTime() <= 7 * 86400000).length;
  const filteredOutcomes = decidedDeals.filter((deal) => {
    const latest = deal.outcomes.find(
      (item) => item.outcomeType !== "reopened",
    );
    return outcomeFilter === "all" || latest?.outcomeType === outcomeFilter;
  });
  return (
    <section className="pipeline-command-desk">
      <header className="pipeline-command-header">
        <div className="pipeline-command-copy">
          <div>
            <h2>{selected ? selected.name : "Pipeline"}</h2>
            {selected && (
              <span className="pipeline-ref">{selected.shortRef}</span>
            )}
          </div>
          <p>
            {selected
              ? activeDeals.length
                ? `${activeDeals.length} active opportunit${activeDeals.length === 1 ? "y" : "ies"}. ${recent} updated in the last 7 days.`
                : "No active deals are recorded in this pipeline."
              : "Create a pipeline from scratch or ask PAIGE to prepare an editable draft."}
          </p>
          {selected && (
            <small>
              {selected.lifecycleStatus} - updated {fmt(selected.updatedAt)} -
              source: Pipeline records
            </small>
          )}
        </div>
        <div className="pipeline-command-actions pipeline-actions">
          <select
            aria-label="Pipeline"
            value={selected?.id || ""}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setFocusedStageId("");
            }}
          >
            {visiblePipelines.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} {String.fromCharCode(183)} {item.shortRef}
              </option>
            ))}
          </select>
          <select
            className="pipeline-folder-filter"
            aria-label="Folder"
            value={folderFilter}
            onChange={(event) => {
              setFolderFilter(event.target.value);
              setSelectedId("");
            }}
          >
            <option value="all">All pipelines</option>
            {workspace.folders
              .filter((item) => item.lifecycleStatus === "active")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            <option value="unfiled">Unfiled</option>
          </select>
          {selected && (
            <button
              className="btn btn-s pipeline-action-paige"
              onClick={askPaige}
            >
              Ask PAIGE
            </button>
          )}
          <button
            className="btn btn-s"
            disabled={!workspace.canManage}
            onClick={onCreatePipeline}
          >
            New pipeline
          </button>
          <button
            className="btn btn-s pipeline-action-new"
            disabled={
              !workspace.canManage || !selected || activeStages.length === 0
            }
            onClick={() => setMode("new")}
          >
            New deal
          </button>
          {selected && (
            <button
              className="btn btn-s pipeline-action-manage"
              onClick={onManage}
            >
              Manage pipeline
            </button>
          )}
          <button
            className="btn btn-s pipeline-action-folders"
            onClick={onFolders}
          >
            Folders
          </button>
        </div>
      </header>
      {!workspace.canManage && (
        <p className="pipeline-desk-permission" role="status">
          Read-only access. You can inspect pipeline records and outcomes, but
          only an authorized Solo owner or administrator can change them.
        </p>
      )}
      {notice && (
        <p className="pipeline-move-status" role="status">
          {notice}
        </p>
      )}
      {archivedPipelines.length > 0 && (
        <section className="pipeline-archived" aria-label="Archived pipelines">
          <header>
            <h2>Archived</h2>
            <p>
              {archivedPipelines.length} pipeline{archivedPipelines.length === 1 ? "" : "s"} filed
              away. Restoring returns a pipeline to the active list; deleting is permanent and only
              possible when nothing depends on it.
            </p>
          </header>
          <ul>
            {archivedPipelines.map((pipeline) => (
              <li key={pipeline.id} className="pipeline-archived-row">
                <div className="pipeline-archived-info">
                  <strong>{pipeline.name}</strong>
                  <span className="pipeline-archived-ref">{pipeline.shortRef}</span>
                </div>
                <div className="pipeline-archived-actions">
                  <button
                    className="btn btn-s pipeline-action-restore"
                    disabled={!workspace.canManage || pending}
                    onClick={() => {
                      void data.pipelineAction({
                        type: "restore-pipeline",
                        pipelineId: pipeline.id,
                        expectedVersion: pipeline.version,
                      });
                    }}
                  >
                    Restore
                  </button>
                  <PipelineDelete
                    pipeline={pipeline}
                    canDelete={workspace.canManage}
                    run={data.pipelineAction}
                    onDeleted={(_id, message) => {
                      setNotice(message);
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {workspace.pipelines.length === 0 ? (
        <div className="pipeline-desk-empty">
          <span className="pipeline-empty-orb">+</span>
          <h2>No pipelines yet</h2>
          <p>
            Start blank and name every stage yourself. No preset pipeline or
            sales taxonomy is added.
          </p>
          <div>
            <button
              className="btn btn-s pipeline-action-new"
              disabled={!workspace.canManage}
              onClick={onCreatePipeline}
            >
              Create pipeline
            </button>
            <button
              className="btn btn-s pipeline-action-paige"
              disabled={!workspace.canManage}
              onClick={askPaige}
            >
              Ask PAIGE to prepare one
            </button>
          </div>
        </div>
      ) : !selected ? (
        <div className="pipeline-desk-empty">
          <h2>No pipelines in this folder</h2>
          <p>Choose another folder or move an existing pipeline here.</p>
        </div>
      ) : (
        <>
          <nav className="pipeline-desk-views" aria-label="Pipeline views">
            <button
              aria-pressed={mode === "board"}
              onClick={() => setMode("board")}
            >
              Active work <span>{activeDeals.length}</span>
            </button>
            <button
              aria-pressed={mode === "outcomes"}
              onClick={() => setMode("outcomes")}
            >
              Outcomes <span>{decidedDeals.length}</span>
            </button>
          </nav>
          {mode === "board" &&
            (activeStages.length === 0 ? (
              <div className="pipeline-desk-empty compact">
                <h2>No active-work stages</h2>
                <p>
                  Manage this pipeline to add a stage and decide whether moves
                  are direct or approval-gated.
                </p>
                <button
                  className="btn btn-s pipeline-action-manage"
                  onClick={onManage}
                >
                  Manage stages
                </button>
              </div>
            ) : (
              <div className="pipeline-desk-board-wrap">
                <label className="pipeline-desk-focus">
                  <span>Focused stage</span>
                  <select
                    value={focusId || ""}
                    onChange={(event) => setFocusedStageId(event.target.value)}
                  >
                    {activeStages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.label} (
                        {
                          activeDeals.filter(
                            (deal) => deal.stageId === stage.id,
                          ).length
                        }
                        )
                      </option>
                    ))}
                  </select>
                </label>
                <div
                  className="pipeline-desk-board"
                  style={{ "--desk-stage-count": activeStages.length }}
                >
                  {activeStages.map((stage) => (
                    <section
                      key={stage.id}
                      className={`pipeline-desk-lane pipeline-lane ${stage.id === focusId ? "is-focused" : ""}`}
                      onDragOver={(event) =>
                        workspace.canManage && event.preventDefault()
                      }
                      onDrop={(event) => {
                        event.preventDefault();
                        const deal = deals.find(
                          (item) =>
                            item.id ===
                            event.dataTransfer.getData("text/pipeline-deal"),
                        );
                        if (deal) beginMove(deal, stage);
                      }}
                    >
                      <header>
                        <div>
                          <span className="pipeline-stage-dot" />
                          <h3>{stage.label}</h3>
                          <strong>
                            {
                              activeDeals.filter(
                                (deal) => deal.stageId === stage.id,
                              ).length
                            }
                          </strong>
                        </div>
                        {stage.description && <p>{stage.description}</p>}
                        {stage.movePolicy === "approval" && (
                          <small>Approval required</small>
                        )}
                      </header>
                      <div className="pipeline-desk-cards">
                        {activeDeals
                          .filter((deal) => deal.stageId === stage.id)
                          .map((deal) => (
                            <DealCard
                              key={deal.id}
                              deal={deal}
                              canManage={workspace.canManage}
                              automationRules={workspace.automationRules}
                              moving={busy}
                              onOpen={() => setDetail(deal)}
                              onMove={() =>
                                setMove({ deal, targetStageId: deal.stageId })
                              }
                              onDragStart={(event) => {
                                event.dataTransfer.setData(
                                  "text/pipeline-deal",
                                  deal.id,
                                );
                                event.dataTransfer.effectAllowed = "move";
                              }}
                              onKeyDown={(event) => onCardKey(event, deal)}
                            />
                          ))}
                        {!activeDeals.some(
                          (deal) => deal.stageId === stage.id,
                        ) && <p>No active deals in this stage.</p>}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            ))}
          {mode === "outcomes" && (
            <section className="pipeline-outcomes">
              <header>
                <div>
                  <h3>Recorded outcomes</h3>
                  <p>
                    Decisions are stored separately from your custom stage
                    names.
                  </p>
                </div>
                <select
                  aria-label="Filter outcomes"
                  value={outcomeFilter}
                  onChange={(event) => setOutcomeFilter(event.target.value)}
                >
                  <option value="all">All outcomes</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                  <option value="not_fit">Not a fit</option>
                  <option value="closed_without_decision">
                    Closed without decision
                  </option>
                </select>
              </header>
              {filteredOutcomes.length === 0 ? (
                <div className="pipeline-desk-empty compact">
                  <h2>No outcomes in this view</h2>
                  <p>
                    Won, lost, not-a-fit, and closed decisions appear only after
                    they are durably recorded.
                  </p>
                </div>
              ) : (
                <div className="pipeline-outcome-list">
                  {filteredOutcomes.map((deal) => {
                    const latest = deal.outcomes.find(
                      (item) => item.outcomeType !== "reopened",
                    );
                    return (
                      <button key={deal.id} onClick={() => setDetail(deal)}>
                        <span>
                          <strong>{deal.title}</strong>
                          <small>{deal.clientName}</small>
                        </span>
                        <span>
                          <b>
                            {outcomeLabel(latest?.outcomeType || deal.status)}
                          </b>
                          <small>
                            {fmt(latest?.outcomeDate || deal.actualCloseDate)}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}
          <details className="pipeline-routing">
            <summary>Routing, approvals, and repair evidence</summary>
            <p>
              Supporting evidence stays secondary. It never substitutes for the
              deal record or its outcome.
            </p>
          </details>
        </>
      )}
      {mode === "new" && selected && (
        <NewDealDialog
          key={data.tenantId}
          tenantId={data.tenantId}
          pipeline={selected}
          stages={activeStages}
          busy={busy}
          onCreated={() => { data.retry(); setMode("board"); if (createRequested) onClearFocus(); }}
          onClose={() => { setMode("board"); if (createRequested) onClearFocus(); }}
        />
      )}
      {detail && !move && !outcome && (
        <DealDialog
          tenantId={data.tenantId}
          onRelationshipChanged={() => data.retry()}
          deal={workspace.deals.find((item) => item.id === detail.id) || detail}
          stages={stages}
          canManage={workspace.canManage}
          automationRules={workspace.automationRules}
          run={run}
          busy={busy}
          onMove={() =>
            setMove({ deal: detail, targetStageId: detail.stageId })
          }
          onOutcome={(outcomeType) => setOutcome({ deal: detail, outcomeType })}
          onClose={() => { setDetail(null); onClearFocus(); }}
        />
      )}
      {move && (
        <MoveDialog
          state={move}
          setState={setMove}
          stages={stages}
          automationRules={workspace.automationRules}
          busy={busy}
          onClose={() => setMove(null)}
          onMove={(target, reviewed) => beginMove(move.deal, target, reviewed)}
        />
      )}
      {outcome && (
        <OutcomeDialog
          state={outcome}
          stages={closingStages}
          automationRules={workspace.automationRules}
          run={run}
          busy={busy}
          onClose={() => setOutcome(null)}
          onSaved={() => {
            setOutcome(null);
            setDetail(null);
            setMode("outcomes");
          }}
        />
      )}
    </section>
  );
}

function NewDealDialog({ tenantId, pipeline, stages, busy, onCreated, onClose }) {
  const [draft, setDraft] = React.useState({
    title: "",
    stageId: stages[0]?.id || "",
    tags: "",
    notes: "",
    clientId: "",
    relationship: "linked",
    unlinkedReason: "",
  });
  const [error, setError] = React.useState("");
  const [command, setCommand] = React.useState(null);
  const save = async () => {
    if (!draft.title.trim() || !draft.stageId) {
      setError("Add a deal name and choose an active-work stage.");
      return;
    }
    if (draft.relationship === "linked" && !draft.clientId) { setError("Choose a canonical client record before creating this opportunity."); return; }
    if (draft.relationship === "unlinked" && !draft.unlinkedReason) { setError("Choose why this prospect is intentionally unlinked."); return; }
    setError("");
    setCommand({
      action: "deal.create",
      pipeline_id: pipeline.id,
      stage_id: draft.stageId,
      ...(draft.relationship === "linked" ? {contact_id: draft.clientId} : {unlinked_reason: draft.unlinkedReason}),
      title: draft.title.trim(),
      tags: draft.tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      notes: draft.notes,
    });
  };
  return (
    <DeskDialog
      title="Create a deal"
      eyebrow={pipeline.name + " - " + pipeline.shortRef}
      onClose={onClose}
      busy={busy}
    >
      {command ? <div className="pipeline-desk-form"><CrmDealCommandReview tenantId={tenantId} command={command} onComplete={onCreated} onClose={() => setCommand(null)}/></div> : <div className="pipeline-desk-form">
        <label>
          <span>Deal or opportunity name</span>
          <input
            autoFocus
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </label>
        <fieldset className="pipeline-relationship-choice"><legend>Client relationship</legend><label><input type="radio" name="deal-relationship" checked={draft.relationship === "linked"} onChange={() => setDraft({...draft,relationship:"linked"})}/>Existing client</label><label><input type="radio" name="deal-relationship" checked={draft.relationship === "unlinked"} onChange={() => setDraft({...draft,relationship:"unlinked"})}/>Intentionally unlinked prospect</label></fieldset>
        {draft.relationship === "linked" ? <DealClientPicker tenantId={tenantId} value={draft.clientId} onChange={clientId => setDraft({...draft,clientId})}/> : <label><span>Why is this prospect unlinked?</span><select value={draft.unlinkedReason} onChange={e=>setDraft({...draft,unlinkedReason:e.target.value})}><option value="">Choose a reason</option><option value="anonymous_prospect">Anonymous prospect</option><option value="early_stage_prospect">Early-stage prospect</option><option value="import_pending_identity">Imported · identity pending</option></select></label>}
        <label>
          <span>Starting stage</span>
          <select
            value={draft.stageId}
            onChange={(event) =>
              setDraft({ ...draft, stageId: event.target.value })
            }
          >
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            Tags <small>comma separated</small>
          </span>
          <input
            value={draft.tags}
            onChange={(event) =>
              setDraft({ ...draft, tags: event.target.value })
            }
          />
        </label>
        <label>
          <span>Notes</span>
          <textarea
            value={draft.notes}
            onChange={(event) =>
              setDraft({ ...draft, notes: event.target.value })
            }
          />
        </label>
        <p className="pipeline-evidence">
          The selected client is stored on the canonical opportunity. Approval follows your current policy.
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="btn btn-s" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-s pipeline-action-new"
            disabled={busy}
            onClick={save}
          >
            {busy ? "Creating..." : "Create deal"}
          </button>
        </footer>
      </div>}
    </DeskDialog>
  );
}

function DealDialog({
  tenantId,
  onRelationshipChanged,
  deal,
  stages,
  canManage,
  automationRules,
  run,
  busy,
  onMove,
  onOutcome,
  onClose,
}) {
  const [draft, setDraft] = React.useState({
    title: deal.title,
    tags: (deal.tags || []).join(", "),
    notes: deal.notes || "",
  });
  const [message, setMessage] = React.useState("");
  const [relationshipEditing, setRelationshipEditing] = React.useState(false);
  const [clientId,setClientId] = React.useState(deal.clientId || "");
  const [relationshipCommand,setRelationshipCommand] = React.useState(null);
  const latest = (deal.outcomes || [])[0];
  const save = async () => {
    const result = await run({
      type: "update-deal",
      dealId: deal.id,
      expectedVersion: deal.version,
      title: draft.title.trim(),
      tags: draft.tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      notes: draft.notes,
    });
    setMessage(result.message);
  };
  const openStages = stages.filter((item) => item.stageType === "open");
  return (
    <DeskDialog
      title={deal.title}
      eyebrow="Deal workspace"
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="pipeline-deal-detail">
        <section>
          <h3>Context</h3>
          <dl>
            <div>
              <dt>Contact or company</dt>
              <dd>{deal.clientName}</dd>
            </div>
            <div>
              <dt>Current stage</dt>
              <dd>
                {stages.find((item) => item.id === deal.stageId)?.label ||
                  "Stage unavailable"}
              </dd>
            </div>
            <div>
              <dt>Next action</dt>
              <dd>{deal.nextAction}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{deal.owner}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{deal.source}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{fmt(deal.updatedAt)}</dd>
            </div>
          </dl>
          {canManage && <div className="pipeline-relationship-editor">{relationshipCommand ? <CrmDealCommandReview tenantId={tenantId} command={relationshipCommand} onComplete={() => { setRelationshipCommand(null); setRelationshipEditing(false); onRelationshipChanged(); setMessage("Client relationship updated from canonical readback."); }} onClose={() => setRelationshipCommand(null)}/> : relationshipEditing ? <><DealClientPicker tenantId={tenantId} value={clientId} onChange={setClientId} autoFocus/><div className="pipeline-relationship-actions"><button className="btn btn-p" disabled={!clientId || clientId===deal.clientId} onClick={() => setRelationshipCommand({action:"deal.assign_contact",deal_id:deal.id,expected_version:deal.version,contact_id:clientId})}>Review client change</button><button className="btn btn-s" onClick={() => setRelationshipEditing(false)}>Cancel</button></div></> : <button className="btn btn-s" onClick={() => setRelationshipEditing(true)}>{deal.clientId ? "Change client" : "Link client"}</button>}</div>}
        </section>
        <section>
          <h3>Editable record</h3>
          <label>
            <span>Name</span>
            <input
              disabled={!canManage || busy}
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </label>
          <label>
            <span>Tags</span>
            <input
              disabled={!canManage || busy}
              value={draft.tags}
              onChange={(event) =>
                setDraft({ ...draft, tags: event.target.value })
              }
            />
          </label>
          <label>
            <span>Notes</span>
            <textarea
              disabled={!canManage || busy}
              value={draft.notes}
              onChange={(event) =>
                setDraft({ ...draft, notes: event.target.value })
              }
            />
          </label>
          <button
            className="btn btn-s pipeline-action-manage"
            disabled={!canManage || busy || !draft.title.trim()}
            onClick={save}
          >
            Save details
          </button>
          {message && <p role="status">{message}</p>}
        </section>
        <section className="pipeline-deal-history">
          <h3>Recorded activity</h3>
          {deal.history.length ? (
            deal.history.map((item, index) => (
              <p key={index}>
                <strong>{item.summary}</strong>
                <small>{fmt(item.createdAt)}</small>
              </p>
            ))
          ) : (
            <p>No activity is recorded.</p>
          )}
          {latest && (
            <p>
              <strong>
                {outcomeLabel(latest.outcomeType)} -{" "}
                {latest.reason || "No reason recorded"}
              </strong>
              <small>{fmt(latest.outcomeDate)}</small>
            </p>
          )}
        </section>
        <section className="pipeline-deal-actions">
          <h3>Operate</h3>
          <button
            className="btn btn-s pipeline-action-manage"
            disabled={!canManage || busy}
            onClick={onMove}
          >
            Move stage
          </button>
          {deal.status === "open" ? (
            <>
              <button
                className="btn btn-s pipeline-outcome-won"
                disabled={!canManage || busy}
                onClick={() => onOutcome("won")}
              >
                Record won
              </button>
              <button
                className="btn btn-s pipeline-outcome-lost"
                disabled={!canManage || busy}
                onClick={() => onOutcome("lost")}
              >
                Record lost
              </button>
              <button
                className="btn btn-s pipeline-outcome-fit"
                disabled={!canManage || busy}
                onClick={() => onOutcome("not_fit")}
              >
                Not a fit
              </button>
              <button
                className="btn btn-s"
                disabled={!canManage || busy}
                onClick={() => onOutcome("closed_without_decision")}
              >
                Close without decision
              </button>
            </>
          ) : (
            <ReopenControl
              deal={deal}
              stages={openStages}
              automationRules={automationRules}
              run={run}
              busy={busy}
              onSaved={onClose}
            />
          )}
          <button
            className="btn btn-s"
            disabled
            title="Client portal is not available yet"
          >
            Send customer invite
          </button>
          <button
            className="btn btn-s pipeline-action-paige"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("paige:open", {
                  detail: {
                    prompt: `Read Pipeline deal ${deal.id} in the selected workspace. Summarize only recorded facts, then prepare editable next steps. Do not auto-send or move it without the governed action result.`,
                  },
                }),
              )
            }
          >
            Ask PAIGE
          </button>
        </section>
        <p className="pipeline-portal-slot">
          Client portal activity: No portal activity source connected, and that
          absence is not a retention or health signal.
        </p>
      </div>
    </DeskDialog>
  );
}

function ReopenControl({ deal, stages, automationRules, run, busy, onSaved }) {
  const [stageId, setStageId] = React.useState(stages[0]?.id || "");
  const [reviewed, setReviewed] = React.useState(false);
  const target = stages.find((stage) => stage.id === stageId);
  const automationRule = activeAutomationFor(automationRules, deal, target);
  const approvalBlocked = target?.movePolicy === "approval";
  return (
    <div className="pipeline-reopen">
      <select
        aria-label="Reopen stage"
        value={stageId}
        onChange={(event) => {
          setStageId(event.target.value);
          setReviewed(false);
        }}
      >
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.label}
            {stage.movePolicy === "approval" ? " - approval required" : ""}
          </option>
        ))}
      </select>
      {approvalBlocked && (
        <p>
          This stage requires the existing governed PAIGE approval path.
          Reopening stays blocked here.
        </p>
      )}
      {automationRule && (
        <p className="pipeline-automation-review" role="status">
          An active{" "}
          {automationRule.sendMode === "auto_send"
            ? "auto-send"
            : "draft-for-review"}{" "}
          {automationRule.composeIntent} automation matches this stage change.
          This MVP blocks the change until the reviewed rule can be bound to the
          saved command; nothing will move or send here.
        </p>
      )}
      <button
        className="btn btn-s pipeline-action-new"
        disabled={
          busy || !stageId || approvalBlocked || Boolean(automationRule)
        }
        onClick={async () => {
          const result = await run({
            type: "reopen-deal",
            dealId: deal.id,
            expectedVersion: deal.version,
            targetStageId: stageId,
            automationReviewed: reviewed,
          });
          if (result?.ok) onSaved();
        }}
      >
        Reopen
      </button>
    </div>
  );
}

function MoveDialog({
  state,
  setState,
  stages,
  automationRules,
  busy,
  onClose,
  onMove,
}) {
  const target = stages.find((item) => item.id === state.targetStageId);
  const automationRule = activeAutomationFor(
    automationRules,
    state.deal,
    target,
  );
  const [reviewed, setReviewed] = React.useState(false);
  return (
    <DeskDialog
      title={`Move ${state.deal.title}`}
      eyebrow="Stage movement"
      onClose={onClose}
      busy={busy}
    >
      <div className="pipeline-desk-form">
        <label>
          <span>Destination stage</span>
          <select
            autoFocus
            value={state.targetStageId}
            onChange={(event) => {
              setState({ ...state, targetStageId: event.target.value });
              setReviewed(false);
            }}
          >
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.label}
                {stage.stageType !== "open"
                  ? " - records outcome"
                  : stage.movePolicy === "approval"
                    ? " - approval required"
                    : ""}
              </option>
            ))}
          </select>
        </label>
        {target?.movePolicy === "approval" && (
          <p>
            PAIGE and the board use the same approval rule. The deal will stay
            put until the existing governed approval succeeds.
          </p>
        )}
        {target?.stageType !== "open" && (
          <p>Closing stages require a separate, durable outcome decision.</p>
        )}
        {automationRule && (
          <p className="pipeline-automation-review" role="status">
            An active{" "}
            {automationRule.sendMode === "auto_send"
              ? "auto-send"
              : "draft-for-review"}{" "}
            {automationRule.composeIntent} automation matches this stage change.
            This MVP blocks the change until the reviewed rule can be bound to
            the saved command; nothing will move or send here.
          </p>
        )}
        {!automationRule && target && (
          <p>No active stage automation is configured for this exact move.</p>
        )}
        <footer>
          <button className="btn btn-s" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-s pipeline-action-manage"
            disabled={
              busy ||
              !target ||
              target.id === state.deal.stageId ||
              Boolean(automationRule)
            }
            onClick={() => onMove(target, reviewed)}
          >
            Continue
          </button>
        </footer>
      </div>
    </DeskDialog>
  );
}

function OutcomeDialog({
  state,
  stages,
  automationRules,
  run,
  busy,
  onClose,
  onSaved,
}) {
  const compatible = stages.filter((stage) =>
    state.outcomeType === "won"
      ? stage.stageType === "won"
      : stage.stageType === "lost",
  );
  const [draft, setDraft] = React.useState({
    outcomeType: state.outcomeType || "won",
    reason: "",
    notes: "",
    outcomeDate: new Date().toISOString().slice(0, 10),
    targetStageId: state.targetStageId || compatible[0]?.id || "",
    automationReviewed: state.automationReviewed === true,
  });
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    const matches = stages.filter((stage) =>
      draft.outcomeType === "won"
        ? stage.stageType === "won"
        : stage.stageType === "lost",
    );
    if (!matches.some((stage) => stage.id === draft.targetStageId))
      setDraft((value) => ({
        ...value,
        targetStageId: matches[0]?.id || "",
        automationReviewed: false,
      }));
  }, [draft.outcomeType, draft.targetStageId, stages]);
  const target = stages.find((stage) => stage.id === draft.targetStageId);
  const automationRule = activeAutomationFor(
    automationRules,
    state.deal,
    target,
  );
  const approvalBlocked = target?.movePolicy === "approval";
  const save = async () => {
    if (draft.outcomeType !== "won" && !draft.reason.trim()) {
      setError("Add a reason for this outcome.");
      return;
    }
    if (automationRule) {
      setError(
        "This stage has an active automation. The outcome is blocked until its exact rule revision can be bound safely.",
      );
      return;
    }
    const result = await run({
      type: "record-outcome",
      dealId: state.deal.id,
      expectedVersion: state.deal.version,
      outcomeType: draft.outcomeType,
      reason: draft.reason,
      notes: draft.notes,
      outcomeDate: draft.outcomeDate,
      targetStageId: draft.targetStageId || undefined,
      automationReviewed: draft.automationReviewed,
    });
    if (result?.ok) onSaved();
    else setError(result?.message || "Outcome was not recorded.");
  };
  return (
    <DeskDialog
      title={`Record outcome for ${state.deal.title}`}
      eyebrow="Durable decision"
      onClose={onClose}
      busy={busy}
    >
      <div className="pipeline-desk-form">
        <label>
          <span>Outcome</span>
          <select
            value={draft.outcomeType}
            onChange={(event) =>
              setDraft({
                ...draft,
                outcomeType: event.target.value,
                automationReviewed: false,
              })
            }
          >
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="not_fit">Not a fit</option>
            <option value="closed_without_decision">
              Closed without decision
            </option>
          </select>
        </label>
        <label>
          <span>Outcome date</span>
          <input
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={draft.outcomeDate}
            onChange={(event) =>
              setDraft({ ...draft, outcomeDate: event.target.value })
            }
          />
        </label>
        <label>
          <span>
            Closing stage <small>optional</small>
          </span>
          <select
            value={draft.targetStageId}
            onChange={(event) =>
              setDraft({
                ...draft,
                targetStageId: event.target.value,
                automationReviewed: false,
              })
            }
          >
            <option value="">Keep current stage</option>
            {stages
              .filter((stage) =>
                draft.outcomeType === "won"
                  ? stage.stageType === "won"
                  : stage.stageType === "lost",
              )
              .map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.label}
                  {stage.movePolicy === "approval"
                    ? " - approval required"
                    : ""}
                </option>
              ))}
          </select>
        </label>
        {approvalBlocked && (
          <p>
            This closing stage requires the existing governed PAIGE approval
            path. Choose no closing stage or another stage to record the outcome
            here.
          </p>
        )}
        {automationRule && (
          <p className="pipeline-automation-review" role="status">
            An active{" "}
            {automationRule.sendMode === "auto_send"
              ? "auto-send"
              : "draft-for-review"}{" "}
            {automationRule.composeIntent} automation matches this stage change.
            This MVP blocks the change until the reviewed rule can be bound to
            the saved command; nothing will move or send here.
          </p>
        )}
        {!automationRule && target && (
          <p>No active stage automation is configured for this exact move.</p>
        )}
        <label>
          <span>Reason {draft.outcomeType !== "won" && <b>required</b>}</span>
          <input
            value={draft.reason}
            onChange={(event) =>
              setDraft({ ...draft, reason: event.target.value })
            }
          />
        </label>
        <label>
          <span>Notes</span>
          <textarea
            value={draft.notes}
            onChange={(event) =>
              setDraft({ ...draft, notes: event.target.value })
            }
          />
        </label>
        <p>
          The outcome, deal history, and linked Rail record will be saved.
          Active stage automations are blocked in this MVP until the exact
          reviewed rule can be bound safely; no message, payment, enrollment, or
          stage change is claimed here.
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="btn btn-s" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-s pipeline-outcome-won"
            disabled={busy || approvalBlocked || Boolean(automationRule)}
            onClick={save}
          >
            {busy ? "Recording..." : "Record exact outcome"}
          </button>
        </footer>
      </div>
    </DeskDialog>
  );
}
