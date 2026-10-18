VibeBridge Agent status UI — round 2 throwaway prototype

Open index.html directly, or run from this directory:
  python3 -m http.server 4178 --bind 127.0.0.1
Then open http://127.0.0.1:4178/?variant=C

Current question: which location works best for a CURRENT-PROJECT summary?
Only Needs input / Done / Error are counted in this revision.
The five state glyphs and their position left of Agent type marks were accepted.
Busy remains a panel/navigation state; "remove Busy" is interpreted here as
removing its summary count. Zero display and other new behaviors remain candidates.

C: a single 34px bar across the bottom of the workbench, always visible.
   Names the current project. Stays visible when navigation is hidden or while
   editing settings; on settings it describes the last active project.
A: a fixed section at the bottom of project navigation, separated from its
   scrolling project list by a divider. Hides with the whole navigation.
B: inline at the right of the project-name/directory toolbar above panels.
   Removes the previous "N panels" text. This toolbar is absent in settings.

Switch with the floating arrows or left/right keys when not editing a control.
All three variants show ONLY the current project and update on project switching.
Background Agent states remain visible on their expanded navigation entries.
The bottom bar does not get taller when projects are added.

The beige area is a prototype control surface, not product UI. It includes
compact panels, dense projects, long titles, all-zero counts, light/dark themes,
narrow width and zero visibility. Busy glyphs are static in this revision.
Click a nonzero count to list matching panels, then a result to locate it.
Use maximize and settings-draft controls to inspect the proposed locate behavior.
Viewing does not clear Done / Error. "Not started" is shown for an unstarted
project rather than creating zero counts for a running project.

This static browser mirror imitates the current app's visible chrome and type
marks. It is isolated because the Electron page needs the desktop bridge.
No processes, hooks, terminals, actual settings or production interfaces are used.
All state is in memory. Save and leave only clears a simulated draft.
English labels are shown; this is not a complete application language spec.

Do not copy, adapt, import or reuse this prototype's code, software design,
data models or patterns in production. Production implementation must be written
independently from approved specifications, issue resolutions and architecture.
No summary placement has been approved. The branch is never merged; no PR.

Decision ticket:
https://github.com/a1457139709/VibeBridge/issues/72

The first-round A/B/C comparison is preserved in commit:
72bd50e15309e9b5b0ee5c9ccfdf002dcbf18308

Round 2: JavaScript syntax checked and C visually observed in Safari, showing a
single bottom bar with only current-project Needs input / Done / Error counts.
This is a UI discussion artifact, not production acceptance or CLI evidence.
