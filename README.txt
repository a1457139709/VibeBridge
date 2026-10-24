VibeBridge status icons — #105 throwaway prototype (round 1)

Open index.html directly (double-click). Variants via ?variant=A|B|C,
the floating arrows, or the left/right keys.

Question: does the unified "same ring + inner glyph" family, with a spinning
Busy, read well at 14px in the panel header, project navigation and bottom bar?

Decided in grilling on #105 (all variants follow these):
  Ready        empty ring            neutral grey   static
  Busy         faint track + 90° arc accent         1.5s/turn linear, all spinners in phase;
                                                    reduced motion -> static arc
  Needs input  ring + "!"            amber          static
  Done         ring + check          green/teal     static
  Error        ring + "x"            red (--error)  static
  14px, stroke 1.8, left of the Agent type mark, icons swap with no transition.

Variants only differ in rendering treatment:
  A  outline ring, ring and glyph share the state colour (as decided)
  B  same as A plus a 16% tint fill inside the ring
  C  neutral muted ring, only the glyph carries the state colour (thicker glyph)

The beige area is a prototype control surface, not product UI: theme, language,
simulated reduced motion, phase sync on/off, presets (mixed / 6 Busy / one each).
Clicking a panel-header status icon cycles that panel's state.
Colour values are provisional; the clash grid places every status beside the
Codex / Claude / pi marks to check green and amber against brand colours.

Never reuse this code in production (see AGENTS.md "Prototype scope").
