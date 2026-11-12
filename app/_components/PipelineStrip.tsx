// The five stages of one agent cycle, with the latest cycle's state: Parse → Search → Decide → Guardrails → Execute.
// Built only from what the order page already loads; no queries. Rendered as a console status line on wide screens
// (01 PARSE ✓ · 02 SEARCH … · 03 DECIDE [FILL] …), a stack of readout rows on phones.
import type { ReactNode } from "react";
import { KILL_SWITCH_REASON } from "@/workflows/standing-order/steps/guardrails";
import { ActionPill } from "./ui";

interface LatestDecision {
  action: string;
  model_action: string;
  guardrail_reasons: string[];
}

interface Props {
  hasSpec: boolean;
  /** How many products the latest check stored (the consideration set). */
  consideredCount: number;
  /** The most recent decision, or null when the order has never been checked. */
  decision: LatestDecision | null;
  /** A purchase was captured. */
  filled: boolean;
  /** An approval link is waiting for the user. */
  approvalOpen: boolean;
}

type State = "active" | "done" | "pending";

interface Stage {
  label: string;
  state: State;
  status: ReactNode;
  /** Shown on hover, e.g. why the guardrails changed the decision. */
  hint?: string;
}

const GREEN = "text-buy";
const RED = "text-refuse";
const AMBER = "text-hold";
const BLUE = "text-accent";
const MUTED = "text-muted";

function buildStages({ hasSpec, consideredCount, decision, filled, approvalOpen }: Props): Stage[] {
  const blocked = decision?.guardrail_reasons.includes(KILL_SWITCH_REASON) ?? false;
  const changed = decision !== null && decision.action !== decision.model_action;
  const reasons = decision?.guardrail_reasons.filter(Boolean).join("; ") || undefined;

  // Where the latest cycle ended, which is the stage to emphasise.
  let end = 0; // parse
  if (decision) {
    if (blocked) end = 3;
    else if (filled || approvalOpen) end = 4;
    else if (changed) end = 3;
    else end = 2;
  } else if (consideredCount > 0) {
    end = 1;
  }
  const state = (i: number, ran: boolean): State => (i === end ? "active" : ran ? "done" : "pending");
  const notRun = <span className={MUTED}>not run yet</span>;

  let guardrails: ReactNode = notRun;
  if (decision) {
    if (blocked) guardrails = <span className={RED}>blocked</span>;
    else if (changed) guardrails = <span className={AMBER}>changed → {decision.action}</span>;
    else guardrails = <span className={GREEN}>passed</span>;
  }

  let execute: ReactNode = notRun;
  if (decision) {
    if (blocked) execute = <span className={RED}>blocked</span>;
    else if (filled) execute = <span className={GREEN}>filled</span>;
    else if (approvalOpen) execute = <span className={BLUE}>approval requested</span>;
    else execute = <span className="text-muted">no action</span>;
  }

  return [
    {
      label: "Parse",
      state: state(0, hasSpec),
      status: hasSpec ? (
        <span className={GREEN}>
          <span aria-hidden>✓</span> spec ready
        </span>
      ) : (
        <span className={AMBER}>needs review</span>
      ),
    },
    {
      label: "Search",
      state: state(1, consideredCount > 0),
      status:
        consideredCount > 0 ? (
          <span className="text-ink-2">
            <span className="tabular-nums text-ink">{consideredCount}</span> via Channel3
          </span>
        ) : (
          notRun
        ),
    },
    {
      label: "Decide",
      state: state(2, decision !== null),
      status: decision ? <ActionPill action={decision.model_action} /> : notRun,
    },
    {
      label: "Guardrails",
      state: state(3, decision !== null),
      status: guardrails,
      hint: blocked || changed ? reasons : undefined,
    },
    {
      label: "Execute",
      state: state(4, decision !== null),
      status: execute,
    },
  ];
}

const LABEL: Record<State, string> = {
  active: "text-accent",
  done: "text-ink",
  pending: "text-muted",
};
const INDEX: Record<State, string> = {
  active: "text-accent",
  done: "text-muted",
  pending: "text-faint",
};

export function PipelineStrip(props: Props) {
  const stages = buildStages(props);
  return (
    <ol
      aria-label="Agent cycle"
      className="flex flex-col font-mono text-[0.8125rem] leading-snug lg:flex-row lg:flex-wrap lg:items-center lg:gap-y-2"
    >
      {stages.map((s, i) => (
        <li
          key={s.label}
          title={s.hint}
          aria-current={s.state === "active" ? "step" : undefined}
          className="flex min-w-0 items-center border-t border-border py-2.5 first:border-t-0 first:pt-0 last:pb-0 lg:border-t-0 lg:py-0"
        >
          <span
            className={`flex min-w-0 flex-1 items-center justify-between gap-3 lg:flex-none lg:justify-start lg:gap-2 ${
              s.state === "active" ? "lg:-mx-1.5 lg:bg-accent/10 lg:px-1.5 lg:py-1 lg:outline lg:outline-accent/30" : ""
            }`}
          >
            <span className={`flex items-baseline gap-2 ${LABEL[s.state]}`}>
              <span className={`text-[0.6875rem] tabular-nums ${INDEX[s.state]}`}>{String(i + 1).padStart(2, "0")}</span>
              <span className={`uppercase tracking-[0.08em] ${s.state === "active" ? "font-bold" : "font-medium"}`}>
                {s.label}
              </span>
              {s.state === "active" && (
                <span aria-hidden className="text-accent lg:hidden">
                  ◂
                </span>
              )}
            </span>
            <span className="min-w-0 text-right text-xs lg:text-left">{s.status}</span>
          </span>
          {i < stages.length - 1 && (
            <span aria-hidden className="hidden px-2 text-faint lg:inline">
              ·
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
