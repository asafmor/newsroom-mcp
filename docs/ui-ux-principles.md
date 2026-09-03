# UI and UX Principles

These principles guide design decisions without freezing the current
interface. They apply to existing and future reader-facing Newsroom surfaces.
Revise them when the product's purpose changes, not whenever a component
changes.

## Editorial hierarchy

The story is the primary unit. Interface controls, metadata, and decoration
should help readers find and understand stories without competing with them.
Use visual hierarchy to distinguish the event, the latest development, its
importance, its freshness, and its supporting evidence.

## Trust and provenance

Source count alone does not establish trust. Present enough source identity,
timing, contribution, and uncertainty for readers to understand why a story
deserves confidence. Avoid visual treatments that imply certainty the data
does not support.

## Progressive disclosure

Support fast scanning first and deeper inspection second. Keep important
context available without forcing every detail into the default view. Opening
details should preserve orientation, focus, and a clear route back.

## Adaptive composition

Mobile, desktop, and MCP App are three required product contexts, not scaled
copies of one layout.

- Mobile prioritizes touch, narrow-screen hierarchy, reachable controls, and
  stable overlays.
- Desktop uses additional space to improve comprehension and scanning rather
  than merely enlarging elements or leaving accidental gaps.
- MCP App respects its host's panel, sandbox, focus, scrolling, and link-opening
  behavior. A standalone imitation does not replace final inspection in the
  real host.

Keep information priority and product character consistent across all three.

## Interaction quality

Controls should communicate purpose, state, and consequence. Prefer familiar
behavior unless a different interaction materially improves the reading task.
Keyboard, pointer, touch, and assistive-technology paths should reach the same
outcomes. Motion should explain change or spatial relationships and remain
safe under reduced-motion preferences.

## States are part of the design

Loading, empty, error, partial-data, long-content, filtered, and constrained
states deserve the same care as the ideal populated view. New features should
identify the states most likely to expose hierarchy, overflow, discoverability,
or recovery problems.

## Visual character

Newsroom should feel editorial, calm, deliberate, and current. It should not
look like a generic administration dashboard or a promotional landing page.
Distinctiveness should come from typography, rhythm, information composition,
and precise interaction details rather than ornamental complexity.

The palette, typefaces, density, shapes, and component patterns may evolve.
Judge them by coherence, legibility, accessibility, and fitness for the
product's purpose instead of preserving current values by default.

## Review standard

An expert review should form and defend an opinion. Automated signals,
accessibility trees, console output, and performance data support that opinion;
they do not replace visual and interaction judgment. Findings should explain
the observed problem, the user consequence, the evidence, and a useful design
direction.
