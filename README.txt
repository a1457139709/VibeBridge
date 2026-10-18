VibeBridge Agent status UI — round 4 throwaway prototype

Open index.html directly, or run from this directory:
  python3 -m http.server 4178 --bind 127.0.0.1
Then open http://127.0.0.1:4178/?variant=C

Selected placement: C, a permanent bottom bar for the CURRENT-PROJECT summary.
Only Needs input / Done / Error are counted in this revision.
The five state glyphs and their position left of Agent type marks were accepted.
Busy remains a panel/navigation state; "remove Busy" is interpreted here as
removing its summary count. Zero counts stay visible and dimmed, as explicitly selected.
The accepted interactions and remaining candidates are distinguished below.

C: a single 34px bar across the bottom of the workbench, always visible.
   Shows only status counts, with no project title or title separator.
   Keeps the project context in its accessible label. Visible when navigation is hidden or while
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
narrow width. Zero counts always remain visible and dimmed. All status glyphs are static, as selected.
Accepted: click a nonzero count to list matching panels, then select a result
to locate it. Zero counts are disabled.
Settings keeps the last viewed project's summary, with live simulated counts.
Use the next-state control while on settings to see the counts update.
Panel location inherits the source view: tiled stays tiled; maximized stays
maximized on the target panel. Settings retains the view from before entry.
Project-title navigation restores that project's previous demo view.
The browser demo focuses the target panel; it has no real terminal input.
Use maximize and settings-draft controls to inspect these paths.
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
C was selected; its leftmost project title was removed at user request.
Remaining interaction details are still under discussion. No merge or PR.

Decision ticket:
https://github.com/a1457139709/VibeBridge/issues/72

The first-round A/B/C comparison is preserved in commit:
72bd50e15309e9b5b0ee5c9ccfdf002dcbf18308

Round 2: JavaScript syntax checked and C visually observed in Safari, showing a
single bottom bar with only current-project Needs input / Done / Error counts.
This is a UI discussion artifact, not production acceptance or CLI evidence.

Round 3: removed the visible project title and divider from C only.

User confirmed keeping dimmed zero counts. The hide-zero comparison control was removed.

Accepted placement: C opens the panel list immediately above the clicked
count, aligned to its left edge and clamped inside the workbench. This keeps
the interaction near the bottom-left controls instead of across the window.
The open count is highlighted. Escape, the close button or repeating the count
closes the list and returns focus to the trigger; outside click also dismisses.
The user accepted the bottom-left anchoring and the list opening, switching,
closing, and panel selection interactions. Selecting another count switches
the list; selecting a panel closes it and locates that panel.

The user accepted keeping the bar visible on settings and showing the last
viewed project's changing counts. All five state glyphs remain static.
The not-started sample and the finer draft-cancellation behavior are still
discussion candidates, not decisions. Production navigation starts a project
on first entry; this sample does not demonstrate startup or CLI behavior.

The anchored popup and Escape dismissal were observed in Safari.

Round 4 validation: script syntax checked. In Safari, locating a Needs input
panel from a maximized Busy panel kept the target maximized and focused it.
While settings was open with a simulated draft, advancing that panel's state
changed the summary from 1 Needs input / 1 Done to 0 Needs input / 2 Done.
The draft and settings page remained present. Demo reset after validation.
