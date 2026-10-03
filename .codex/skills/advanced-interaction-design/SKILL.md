---
name: advanced-interaction-design
description: Diagnose and implement focused interaction polish in an existing app when a UI needs better continuity, direct manipulation, selection feedback, disclosure, progress, reordering, swipe actions, card depth, or animated tag state. Preserve the product's visual language and choose the smallest matching interaction pattern.
---

# Advanced Interaction Design

Improve an existing flow through one deliberate interaction pattern, not a visual rewrite.

## Workflow

1. Inspect the live component, its state model, surrounding navigation, and existing motion language. Identify the concrete break in continuity, feedback, discoverability, or control. The diagnosis is complete when the observed problem can be stated in one sentence without naming a solution.
2. Read [references/patterns.md](references/patterns.md) and choose one pattern for each independent user scenario. Prefer the pattern with the fewest new states and gestures. Combine patterns only when the request contains separate flows that remain understandable on their own.
3. Define the interaction contract before editing: trigger, transient states, committed state, cancellation, fallback, keyboard behavior, focus behavior, touch/mouse thresholds, and reduced-motion behavior. Preserve the host app's confirmation and recovery rules for destructive actions.
4. Implement inside the existing component and design system. Keep the current layout, vocabulary, tokens, and data flow unless the diagnosed problem requires a structural change. Motion must explain state change; decorative motion is optional and subordinate.
5. Verify the primary path, cancellation or fallback path, keyboard path, narrow viewport, and `prefers-reduced-motion`. For gesture work, also verify click-versus-drag separation and boundary behavior. Report simulator/browser checks separately from real-device checks.

## Deliverable

Lead with:

- **Selected interaction:** the pattern name and the affected flow.
- **Why this fits:** the diagnosed problem and why this is the smallest sufficient pattern.
- **Interaction behavior:** trigger, states, motion, fallback, accessibility, and reduced-motion behavior.
- **Changes and verification:** files changed, observable checks, and anything still requiring a real device.

When the user asks for an implementation prompt, add a concise copyable prompt that names the selected pattern, preserves the existing interface, and includes the interaction contract. Do not output the full pattern catalog unless requested.
