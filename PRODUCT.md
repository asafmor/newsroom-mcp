# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Newsroom serves people who want to follow important AI developments without
reading a repetitive article-by-article stream. A separate curating AI agent
uses the MCP server to turn incoming material into that reader-facing feed.

## Product Purpose

Newsroom collects signals from varied AI-related sources and presents them as
evolving stories. It should help a reader understand what happened, what
changed, why it matters, and which sources support the story.

Success means the feed remains concise, current, trustworthy, and easy to scan
as its source coverage and feature set grow.

## Positioning

Newsroom is story-oriented rather than article-oriented. It groups overlapping
coverage, preserves meaningful developments, and exposes source provenance
instead of treating every link as a separate news event.

## Operating Context

The product has three reader-facing contexts:

- a mobile web experience;
- a desktop web experience;
- an MCP App embedded in an AI host.

The standalone website reads a periodically published static feed snapshot.
The MCP App receives the same feed model through an MCP tool result. The three
contexts should feel like one product while adapting to their different space,
input, scrolling, and host constraints.

## Capabilities and Constraints

- Semantic curation belongs to the calling AI agent. The server provides
  deterministic ingestion, persistence, story operations, and feed delivery.
- The public site remains static and reads the committed `feed.json` snapshot.
- New providers and new forms of content should fit without redefining the
  product as a conventional article reader.
- Product and design guidance must support future surfaces and features. It
  must not make today's components or layouts permanent.

## Evidence on Hand

The repository contains the original product rationale in `IDEA.md`, the
implemented architecture in `docs/architecture.md`, and runnable standalone
and MCP App surfaces. Future work must not invent audience research,
testimonials, usage metrics, or editorial guarantees that are not present in
the repository.

## Product Principles

1. **Clarify the development, not the volume of coverage.** Help readers see
   the event and its meaningful changes before the list of articles.
2. **Make trust inspectable.** Preserve freshness, provenance, corroboration,
   and uncertainty wherever they affect interpretation.
3. **Optimize for informed scanning.** A reader should identify what deserves
   attention quickly, then inspect detail without losing context.
4. **Adapt without fragmenting.** Mobile, desktop, and MCP App experiences may
   compose differently but should retain the same information priorities and
   product character.
5. **Let the interface evolve.** Preserve outcomes and principles; replace
   patterns that no longer serve them.

## Accessibility & Inclusion

The reader-facing product should remain understandable and operable with
keyboard, touch, zoom, reduced motion, high contrast, and assistive technology.
Accessibility is part of interaction and visual quality, not a separate final
check.
