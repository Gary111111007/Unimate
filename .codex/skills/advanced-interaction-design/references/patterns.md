# Interaction pattern catalog

Choose by the user's problem, not by visual novelty. Each contract below is the minimum behavior that makes the pattern coherent.

## 1. Radial theme transition

Use when a theme or palette change currently flashes the whole interface at once. Reveal the new theme from the trigger toward the farthest viewport corner while both themes keep identical geometry. Use the trigger center for keyboard activation, fall back to an instant change when snapshot animation is unavailable, and disable the reveal for reduced motion.

## 2. Drag-to-reorder

Use for a persistent ordered list whose order has meaning. Require a deliberate hold or drag handle, lift the dragged item out of normal flow, show a stable insertion target, animate only displaced siblings, preserve scroll near edges, and expose an accessible non-drag alternative when practical.

## 3. Staggered bulk selection

Use when many peer items enter or leave selection together. Commit selection state immediately, then stagger only the visible feedback over a short bounded interval. Keep individual toggles responsive and skip the stagger for reduced motion.

## 4. Velocity-based slider snap

Use when a slider selects discrete values and intent is better expressed by both position and flick direction. Snap after release using distance plus velocity, make the selected value explicit, support arrows and direct input, and use a spring that settles without overshoot that changes the value.

## 5. Animated text disclosure

Use for expandable explanatory copy where preserving reading context matters. Animate between measured heights rather than arbitrary limits, rotate or replace the disclosure affordance, keep `aria-expanded` and focus semantics correct, and use an instant state change for reduced motion.

## 6. Spring stepper progress

Use for a short multi-step flow where users need a clear sense of current and completed work. Separate completed, current, and upcoming states; connect them with a progress track; allow only valid navigation; and use a restrained spring that never obscures labels or status.

## 7. Ripple feedback for related switches

Use when several related toggles need a shared sense of cause and scope. Start feedback at the switch that changed, let it travel only through the owning surface, and update all logical state immediately. Keep labels clickable, expose native switch semantics, and remove the ripple for reduced motion.

## 8. Curved card deletion

Use for swipe-to-delete on a card when the gesture needs a clear threshold. Keep normal scrolling available, reveal the destructive action progressively, commit only past an explicit threshold, and route the committed action through the host product's confirmation or undo policy. Snap back cleanly on cancellation and provide a visible non-swipe control.

## 9. Stacked card scroll

Use for browsing ordered cards when depth and focus are more important than dense comparison. Pin the active card, compress prior cards into a legible stack, keep upcoming cards readable, derive transforms continuously from scroll position, and preserve normal document scrolling and focus order.

## 10. Expanding tag selection

Use when compact peer tags need stronger selected-state feedback. Expand the active tag within the same row, reveal a check or supporting text without reordering peers, keep wrap behavior predictable, and expose `aria-pressed` or equivalent selection semantics.

## Selection tie-breakers

- Theme changes: radial theme transition.
- Ordered content: drag-to-reorder; use stacked cards only when browsing, not editing order.
- Many simultaneous selection changes: staggered bulk selection; use expanding tags for one-at-a-time emphasis.
- Dense explanatory text: animated text disclosure.
- Discrete continuous control: velocity-based slider snap.
- Destructive swipe: curved card deletion, plus the product's existing confirmation or undo contract.
- If motion does not clarify a state change, keep the interaction instant.
