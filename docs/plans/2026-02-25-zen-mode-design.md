# Zen Mode Design

## Summary

A meditation screen triggered when agents are busy and the user is idle, featuring a chibi conductor mascot meditating with ambient floating musical notes.

## Mascot — Chonky Owlblob

- **Chosen design**: Chonky Owlblob — a wide, round owl-blob hybrid
- Features: big round eye discs, stubby ear tufts, small beak, conductor hat with purple band, chevron belly pattern, stubby wing arms, tiny owl feet
- Color palette: purple tones (#5c4a6a body, #7a6890 belly, #8a78a0 eye discs, #e8a838 beak/feet, #b8a0d8 hat band)
- SVG source: `docs/plans/mascot-saved/chonky-owlblob.svg`
- Lives in the Conductor header during normal use
- Future: animates to reflect app state (conducting, tapping foot, sleeping)

## Trigger

- **Auto-nudge**: All agents busy + user idle ~45s → mascot in header starts subtle animation (glow/nod off). Hover shows "Zen mode" tooltip. Click enters.
- **Manual**: Click mascot anytime to enter zen mode.
- No text popups or interruptions.

## Scene (v1)

- Dashboard fades out, full-panel scene fades in
- Calm gradient background (muted, warm tones)
- Conductor mascot center stage, cross-legged, eyes closed
- Breathing animation (chest rises/falls on slow cycle)
- Musical notes drift upward like bubbles
- SVG + CSS animations, zero dependencies

## Agent Progress

- Agent completes → a brighter musical note floats in from the edge
- No text, no toasts

## Exit

- Click anywhere to fade back to dashboard
- No forced transitions — stays as long as user wants

## Technical Approach

- SVG mascot with CSS keyframe animations
- No extra dependencies
- New component: `ZenMode.tsx`
- Idle detection via last interaction timestamp in Zustand store
- Mascot SVG asset: `webview-ui/src/assets/chonky-owlblob.svg`
- Animation timing (meditative pace):
  - Float: 6s cycle, cubic-bezier(0.45, 0, 0.55, 1)
  - Note drift: 8s cycle
  - Glow pulse: 5s cycle
  - Star twinkle: 4s cycle

## Future Enhancements (not v1)

- Progressive scene transformation (cool→warm gradient, flowers, bloom on all-complete)
- Conductor wakes up smiling when all agents done
- Guided breathing exercise overlay
- Mascot reuse across app (conducting, celebrating, sleeping)
