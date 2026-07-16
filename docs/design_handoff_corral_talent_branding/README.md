# Handoff: Corral Talent branding

## Overview
Light rebrand of the asp reference SPA for its open-source hard fork, published as **Corral Talent** (pilot: Oklahoma State University — colors stay in the existing OSU-adjacent palette, but nothing is branded *for* OSU). This package replaces the Momentum-era placeholder typographic "O" mark (flagged D9 in the mentor sidebar and in docs/claude_design_handoff_momentum_redesign/README.md) with a final mark, wordmark, favicon, and in-app lockups.

**Selected concept (1c "Pen & Talent"):** an open round corral pen (circle stroke with a gate gap at 3 o'clock) with a dot — the talent — inside. Subtle western nod, friendly/energetic, reads at 16px.

## About the Design Files
Files here are **design references created in HTML** — they show intended look, not production code. Recreate them in the asp codebase's existing environment (React 19 + Tailwind 4, tokens in `ui/src/index.css`) using its established patterns. `Corral Talent - Logo Concepts.dc.html` is the exploration canvas; concept **1c** is the winner.

## Fidelity
**High-fidelity.** Colors, geometry, type, and sizes are final. Implement pixel-perfect.

## The Mark
Single SVG geometry, three tones (orange / ink / white), viewBox="0 0 48 48": <circle cx="24" cy="24" r="16" fill="none" stroke="{color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="76.5 24" stroke-dashoffset="88.5"/> + <circle cx="24" cy="24" r="5.5" fill="{color}"/>
- Gate gap is centered at 3 o'clock (dasharray 76.5 24, dashoffset 88.5 on a r=16 circle, circumference ≈100.5).
- **Favicon variant** (heavier for 16px): r=17, stroke-width=9, dasharray "81 25.8", dashoffset "93.9", dot r=6.5.
- Never distort, recolor outside the three tones, or close the gate gap.

## Wordmark
"**Corral** Talent" — Bricolage Grotesque (already loaded). "Corral" weight 800, "Talent" weight 500. Light surfaces: Corral #14110F, Talent #3A332D. Dark surfaces: Corral #FFFFFF, Talent rgba(255,255,255,0.75). Always HTML text in-app, never rasterized.

## Lockups (from the winning concept card)
- **Applicant header:** 28px tile (bg #FF7300, radius 8px) containing white mark at 18px + "Corral Talent" 13px/700 Bricolage Grotesque in ink.
- **Mentor sidebar (on #14110F):** bare orange mark at 22px (no tile) + existing "Mentor" label.
- **App icon:** white mark on #FF7300 rounded tile (radius ≈ 25% of edge).

## Design Tokens
All existing — no token changes: primary #FF7300, ink #14110F, ink-soft #3A332D, app-bg #FAF7F4, hairline #ECE5DD. Fonts: Bricolage Grotesque (display), Hanken Grotesk (body).

## Assets (assets/)
- corral-mark-orange.svg / corral-mark-ink.svg / corral-mark-white.svg — bare mark, three tones
- corral-app-icon.svg — white mark on orange rounded tile
- corral-favicon.svg — heavier-stroke variant tuned for 16px
- corral-lockup.svg / corral-lockup-inverted.svg — mark + wordmark (live text; renders correctly only where Bricolage Grotesque is loaded — convert to outlines for external use)

## Files
- `Corral Talent - Logo Concepts.dc.html` — exploration canvas (1a/1b/1c; 1c selected)
- `proposals/` — pairmode phase + story docs, ready to shift into the build pipeline

## Proposals (pairmode)
`proposals/phase-PM055-main.md` plus four UI stories (UI-901…UI-904). **IDs are placeholders** — renumber the phase into the real sequence after PM054 and the stories into the UI rail's actual next numbers when adopting. Story format mirrors docs/stories/OSS/*.md frontmatter + Requires/Ensures/Instructions/Tests.

## Explicitly out of scope
- Repo/package rename (`asp` → `corral-talent` in package.json names, ports doc, clone URLs) — separate OSS-rail decision.
- Any OSU lockup, Pistol Pete, or OSU-official brand element. The palette overlap is intentional and generic.
