VibeBridge Agent status UI — throwaway decision prototype

Question: where should per-project status summaries live, and how should the
same status glyph identify a panel in the workbench and project navigation?

Open index.html directly, or run from this directory:
  python3 -m http.server 4178 --bind 127.0.0.1
Then open http://127.0.0.1:4178/?variant=A

A: top summary entry, opening counts grouped by project.
B: counts beneath each project in navigation; top fallback when nav is hidden.
C: persistent bottom rows grouped by project.
Switch with the floating arrows or left/right keys when not editing a control.

The beige bar is a prototype control surface, not proposed product UI.
It includes compact panels, dense projects, long titles, all-zero counts,
light/dark themes, narrow width, optional Busy motion, and zero visibility.
Click a count to list matching panels. Click a result to locate the panel.
Use panel maximize, then locate a different panel to inspect the return to tiling.
Use the settings draft simulation before locating a panel to inspect leave choices.

All proposed defaults are UNCONFIRMED. Ready/Busy/Needs input/Done/Error semantics,
per-panel counting, background-project scope, and viewing not clearing results
come from the existing decisions. The sample CLI text is illustrative only.
No processes, hooks, terminals, settings files, or production interfaces are used.
All state is in memory. Save and leave only clears a simulated draft.
English product labels are shown; this is not the full application language spec.

This static browser mirror uses the current app's visible chrome and type marks.
It is isolated because the existing Electron page requires the desktop bridge.
The prototype is never part of a production build. Do not copy, adapt, import,
or reuse its code, software design, data models, or patterns in production.
Production must be independently implemented from the approved specification,
issue resolutions, and architecture decisions. No variant has been approved.

Decision ticket:
https://github.com/a1457139709/VibeBridge/issues/72

Observed in Safari: A/B/C render; light and dark; compact/narrow panel shapes;
settings draft -> project summary -> matching panel -> save and leave ->
background project location. Counts remain unchanged by viewing.
This is a discussion artifact, not a production acceptance test or CLI evidence.
