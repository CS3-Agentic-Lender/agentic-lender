# Design: AL-348

## Design decision

Keep the portal light, with controls and portfolio towers on a large dark stage. Tower height is after-rise DTI. Rings mark 40%/50%. The table retains the figures without 3D.

## Alternatives considered

Three demos: a 2D dial, a full dark 3D page and a light page with a dark stage. The owner approved the last option.

## Why this was chosen

It retains the light portal around the selected stage and places controls with the portfolio. The facts record approval but no further personal preference rationale. The owner also dropped separate DTI and surplus charts.

## Implementation limits

The stage reuses lazy loading, off-screen pausing and WebGL release. Without WebGL the controls work and the table carries the figures. A sample preview is not a live calculation.

## Evidence

[PR #286](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/286), merged 26 Nov; review 712a559 and sprint3-facts.md.
