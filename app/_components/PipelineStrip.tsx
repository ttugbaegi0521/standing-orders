// The five stages of one agent cycle, with the latest cycle's state: Parse → Search → Decide → Guardrails → Execute.
// Built only from what the order page already loads; no queries. A row of nodes on wide screens, a stack on phones.
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

const GREEN = "text-pos";
const RED = "text-neg";
const AMBER = "text-warn";
const BLUE = "text-accent";
const MUTED = "text-faint";

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
      status: consideredCount > 0 ? <span className="text-ink-2">{consideredCount} via Channel3</span> : notRun,
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

const RULE: Record<State, string> = {
  active: "border-accent",
  done: "border-rule-strong",
  pending: "border-rule",
};
const LABEL: Record<State, string> = {
  active: "text-accent",
  done: "text-ink",
  pending: "text-faint",
};

export function PipelineStrip(props: Props) {
  const stages = buildStages(props);
  return (
    <ol aria-label="Agent cycle" className="grid grid-cols-1 gap-y-1 sm:grid-cols-5">
      {stages.map((s, i) => (
        <li
          key={s.label}
          title={s.hint}
          aria-current={s.state === "active" ? "step" : undefined}
          className={`relative flex min-w-0 items-center justify-between gap-3 border-l-2 py-2 pl-3 sm:block sm:border-l-0 sm:border-t-2 sm:py-0 sm:pl-0 sm:pr-5 sm:pt-3 ${RULE[s.state]}`}
        >
          <p className={`flex items-baseline gap-2 ${LABEL[s.state]}`}>
            <span className="font-mono text-xs tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            <span className={`font-serif text-lg leading-none ${s.state === "active" ? "font-medium" : ""}`}>{s.label}</span>
          </p>
          <p className="min-w-0 text-right text-sm sm:mt-2 sm:text-left">{s.status}</p>
          {i < stages.length - 1 && (
            <span aria-hidden className="absolute right-1.5 top-3 hidden text-sm leading-none text-faint sm:block">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
