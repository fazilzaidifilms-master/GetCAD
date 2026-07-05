export interface WorkflowStep {
  name: string;
  summary: string;
  detail: string;
}

// The operational sequence every order moves through. Names/order match the
// platform's actual state machine (client submit -> quote -> assign -> produce
// -> independent QC -> validate -> deliver) — this describes the real process,
// not aspirational marketing steps.
export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    name: "Client",
    summary: "A business submits a CAD requirement.",
    detail:
      "A jewelry business submits a production specification — reference geometry, stone requirements, manufacturing constraints. No relationship with a specific designer is required or possible at this stage.",
  },
  {
    name: "Platform Review",
    summary: "The request is reviewed and quoted before any work begins.",
    detail:
      "The requirement is checked for completeness and quoted. This is a control point, not a formality: work does not start on an ambiguous or unpriced brief.",
  },
  {
    name: "Designer Assignment",
    summary: "A vetted designer is assigned. Identities stay protected in both directions.",
    detail:
      "The order is assigned to a designer who has completed onboarding and accepted the platform's operating agreement. The client never learns who the designer is; the designer never learns who the client is.",
  },
  {
    name: "CAD Production",
    summary: "The designer produces the model against the specification.",
    detail:
      "The designer works the brief inside the platform. Files, revisions, and communication all move through the same identity-protected channel — nothing is exchanged off-platform.",
  },
  {
    name: "Independent QC",
    summary: "A reviewer uninvolved in the design checks the work before the client sees it.",
    detail:
      "Before a client previews anything, an independent reviewer — never the original designer, never identified to either party — checks the model against manufacturing and quality standards. This gate cannot be skipped.",
  },
  {
    name: "Manufacturing Validation",
    summary: "The file is checked against real production constraints.",
    detail:
      "Beyond design correctness, the deliverable is checked for production readiness — the practical constraints of casting and finishing, not just whether the model looks right on screen.",
  },
  {
    name: "Delivery",
    summary: "The client receives the validated files. Every step is on record.",
    detail:
      "The client receives the finished, QC-passed files. The full sequence of what happened and when is recorded and available — nothing about how the order was fulfilled is left implicit.",
  },
];

/** Condensed sequence for the homepage — name + one line, no detail paragraph. */
export function WorkflowCompact() {
  return (
    <ol className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-7">
      {WORKFLOW_STEPS.map((step, i) => (
        <li key={step.name} className="bg-card p-4">
          <span className="tabular font-mono text-xs text-muted-foreground">
            {String(i + 1).padStart(2, "0")}
          </span>
          <p className="mt-1 text-sm font-medium">{step.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{step.summary}</p>
        </li>
      ))}
    </ol>
  );
}

/** Full step-by-step sequence with rationale, for /how-it-works. */
export function WorkflowDetailed() {
  return (
    <ol className="divide-y divide-border rounded-lg border border-border bg-card">
      {WORKFLOW_STEPS.map((step, i) => (
        <li key={step.name} className="flex gap-4 p-5">
          <span className="tabular shrink-0 font-mono text-sm text-muted-foreground">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div>
            <p className="font-medium">{step.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
