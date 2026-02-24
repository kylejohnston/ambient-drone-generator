# Auto-Start on Keypress — Design

**Goal:** When the user taps a key to add a note while the drone is stopped, automatically start the drone.

**Design:** In `addNote()` in `js/main.js`, before pushing the note to state, check `!state.isPlaying`. If true, call `await startDrone()` and mirror the play button UI update (add `playing` class, update aria-label). `addNote()` is already async, so this composes cleanly.

**Scope:** Single function, `js/main.js` only.
