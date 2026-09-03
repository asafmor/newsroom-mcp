# Review Method

## Review the implemented experience

Start from the rendered product, not the stylesheet or component tree. Operate
the primary task naturally before inspecting implementation details. Determine
which states and interactions matter from the review request and current diff;
do not run an exhaustive fixed checklist when it adds no evidence.

Always examine these product contexts:

1. **Mobile web:** begin at 390 × 844 CSS pixels. Add a narrower or shorter
   viewport only when the implementation suggests a boundary problem.
2. **Desktop web:** begin at 1440 × 1000 CSS pixels. Judge composition and
   information density, not only responsive correctness.
3. **MCP App:** use the real MCP host or development inspector that renders the
   MCP App. Preserve the host's actual panel dimensions and behavior. A local
   component rendered with MCP-like styles is supporting evidence, not a
   substitute.

Review the changed feature wherever it appears. Also inspect enough of the
surrounding product to judge hierarchy and coherence. If a context does not
contain the feature, say so and assess only relevant product-level effects.

Inspect light and dark appearance when the product supports both. Capture
loading, empty, error, overflow, long-content, filtered, open/closed, focus, or
motion states when relevant to the change or likely to reveal a defect.

## Gather evidence

Save evidence under the caller-provided run directory with descriptive names,
for example:

```text
mobile-overview.png
desktop-overview.png
mcp-app-overview.png
mobile-source-panel-open.png
desktop-filter-overflow.png
```

Capture:

- at least one overview screenshot for each successfully reviewed context;
- focused screenshots for every visual finding that needs them;
- before/after interaction states when the transition or state change matters;
- accessibility-tree or keyboard evidence for interaction findings;
- console, network, computed-layout, or performance data when it supports a
  finding.

Evidence should answer a question. Do not create dozens of near-identical
screenshots or paste raw diagnostic output without interpreting it.

Browser emulation does not prove real touch behavior. Flag gesture findings
that need iOS or Android device confirmation.

## Form an expert opinion

Judge the interface as a coherent product, not as a collection of lint rules.
Pay particular attention to:

- editorial hierarchy and speed of comprehension;
- discoverability, affordance, feedback, and recovery;
- cognitive load and progressive disclosure;
- trust, provenance, freshness, and uncertainty;
- typography, spacing, color, contrast, rhythm, and visual character;
- adaptive composition across the three contexts;
- keyboard, touch, zoom, reduced-motion, and assistive-technology behavior;
- realistic content extremes and non-ideal states;
- consistency with product principles without preserving weak incumbent
  patterns merely because they already exist.

Automated accessibility or performance signals support the assessment. They
do not determine the design verdict.

## Prioritize

Use these severities:

- **P0 — Blocker:** prevents a primary task, causes serious data or trust
  misunderstanding, or makes the experience unusable for a required access
  path.
- **P1 — Major:** materially harms comprehension, interaction, accessibility,
  or one required product context.
- **P2 — Moderate:** noticeable friction or visual weakness worth addressing
  in the current feature when practical.
- **P3 — Minor:** polish or future improvement that should not block delivery.

Limit the main list to the findings that change a developer's decisions. Group
repeated symptoms under one underlying issue.

## Return this report

```markdown
# UI/UX Review

## Verdict
[Ready / Ready with concerns / Not ready, followed by a direct explanation.]

## Scope and evidence
- Change or feature reviewed:
- Mobile web:
- Desktop web:
- MCP App:
- Interaction and runtime evidence:
- Not verified:

## Strengths to preserve
- [Specific strength and why it works.]

## Findings

### [P1] Concise finding title
- **Observed:** [What happened, in which context and state.]
- **Evidence:** [Screenshot path and any relevant browser data.]
- **Why it matters:** [User or product consequence.]
- **Recommendation:** [Concrete design direction, without implementing it.]
- **Acceptance signal:** [What a developer should be able to observe after a
  successful fix.]

## Cross-context assessment
[Explain whether the three contexts feel coherent and appropriately adapted.]

## Uncertainties
[List missing host access, device confirmation, data, or assumptions. Write
"None" when complete.]
```

Do not include implementation patches. You may identify likely responsible
areas when that helps the developer navigate, but keep the recommendation
about user-visible behavior and design intent.
