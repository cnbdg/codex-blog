# Animation Plans

Audited with the `improve-animations` / `review-animations` bar
(Emil Kowalski's animation philosophy). Commit stamped: `eb7dbea`.

## Summary

The project already has a mature motion system: macOS/iOS platform split,
View Transitions with WAAPI fallback, `prefers-reduced-motion` coverage, and
GPU-friendly transform/opacity animation. The audit found four real issues,
all fixed and verified in a real browser (CDP).

## Findings and status

| # | Severity | Category | Location | Finding | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | HIGH | Performance | `style.css` `.status-dot`/`.online-dot` (`statusPulse`/`softPulse`), `design-system.css` `dsStatusPulse` | Infinite `box-shadow` pulse animates a paint property every frame on always-visible status dots; three overlapping pulse animations fight for the same element | DONE |
| 2 | MEDIUM | Performance | `style.css` multiple bare `transition:.2s`/`.18s`/`.25s` | Bare shorthand defaults to `transition: all`, animating unintended properties off-GPU | DONE |
| 3 | MEDIUM | Cohesion | `motion-system.css` backdrop close (macOS 180ms / iOS 250ms) | Bare `ease-in` on exit diverges from the panel close curve `cubic-bezier(.4, 0, .8, .2)` | DONE |
| 4 | LOW | Missed opportunity | `forum.js` `toggleLike` | Like/bookmark state flips with no feedback; a 220ms pop is the rare delight moment | DONE |

## Implementation notes (self-contained)

### 1. Status-dot halo (GPU-only)

File: `design-system.css` (loaded last, wins the cascade).

```css
.status-dot,
.online-dot {
  position: relative;
  animation: none !important;
}
.status-dot::before,
.online-dot::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--ds-positive) 12%, transparent);
  opacity: .55;
  animation: ds-status-halo 2.6s ease-in-out infinite;
}
@keyframes ds-status-halo {
  50% { opacity: 1; transform: scale(1.35); }
}
```

The static halo lives in `box-shadow` (set once, never animated); the pulse
animates only `opacity` + `transform` (compositor-friendly). `reduced-motion`
already zeroes `.status-dot` animation in `design-system.css`; the `!important`
on the base rule keeps the old `style.css` pulses from resurfacing.

### 2. Bare transitions made explicit

File: `style.css`. Replaced every bare `transition:.2s`-style shorthand with
the exact properties that actually change:

- `body`: `background-color .25s ease, color .25s ease`
- `.post-item`: `background-color .2s ease`
- `.post-item h2 a`: `background-size .3s ease` (gradient underline)
- `.thread-card` base: `background-color .18s ease`
- `.thread-card::before` accent bar: `opacity .2s ease, transform .2s ease`
- `#toTop`: `opacity .2s ease, transform .2s ease`
- `#navBackdrop`: `opacity .25s ease, visibility .25s ease`
- `.notification-item`: `background-color .18s ease`
- `.dm-composer-foot button`: `transform .2s ease, box-shadow .2s ease`
- `#toast`: `opacity .2s ease, transform .2s ease`

### 3. Backdrop exit curve

File: `motion-system.css`. Both backdrop-close rules now use the same curve as
the panel close:

```css
animation: platform-backdrop-close 180ms cubic-bezier(.4, 0, .8, .2) both !important; /* macOS */
animation: platform-backdrop-close 250ms cubic-bezier(.4, 0, .8, .2) both !important; /* iOS */
```

### 4. Like/bookmark pop feedback

File: `forum.js`, in `toggleLike`. After the DOM update, a 220ms WAAPI pop
plays on the button, gated behind `prefers-reduced-motion`:

```js
function popButton(button) {
  if (!button?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  button.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.14)" },
      { transform: "scale(1)" }
    ],
    { duration: 220, easing: "cubic-bezier(.2, .9, .25, 1.08)" }
  );
}
```

## Verification

- `node --check app.min.js` passes; CSS brace balance passes
  (source and minified).
- Real-browser CDP run on `home`, `forum`, `profile`, `notifications`,
  `messages`: all render with bundled assets, zero console errors.
- Computed styles confirm: `.status-dot` has `animation: none` and its
  `::before` runs `ds-status-halo` with an active scale transform; `#toTop`
  transitions only `opacity, transform`.
- Rebuild with `node tools/build-assets.mjs` after touching source files;
  commit `app.min.js` / `style.min.css` / rewritten `index.html` together.
