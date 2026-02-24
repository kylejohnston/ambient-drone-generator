# Auto-Start on Keypress Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When the user taps a key to add a note while the drone is stopped, automatically start the drone and update the play button UI.

**Architecture:** In `addNote()` in `js/main.js`, check `!state.isPlaying` before pushing the note. If the drone isn't running, call `await startDrone()` then mirror the exact play button UI update that `bindPlayButton()` performs (add `playing` class, update aria-label). `addNote()` is already `async` so the await composes cleanly, and the note is added after the drone starts.

**Tech Stack:** Vanilla JS (no build tools, no framework)

---

## Context

- `js/main.js` — the only file to touch
- `addNote()` starts around line 772; it is `async` and already calls `await initAudioContext()`
- `startDrone()` (line 1299) is `async`; sets `state.isPlaying = true` and initialises the full audio chain (effects, scheduler, layer sources)
- `bindPlayButton()` (line 458) manages play button visual state: `playBtn.classList.add('playing')` and `playBtn.setAttribute('aria-label', 'Pause drone')`
- The play button is `document.getElementById('play-btn')`

---

### Task 1: Auto-start drone when a note is added

**Files:**
- Modify: `js/main.js` — `addNote()` function (~line 772)

**Step 1: Locate `addNote()` and add the auto-start block**

Find `addNote()` in `js/main.js`. After `await initAudioContext()` and the time-calculation / snap logic, but **before** `state.sequencer.notes.push(...)`, insert:

```js
// Auto-start the drone when a note is added while stopped
if (!state.isPlaying) {
  await startDrone();
  const playBtn = document.getElementById('play-btn');
  if (state.isPlaying) {
    playBtn.classList.add('playing');
    playBtn.setAttribute('aria-label', 'Pause drone');
  }
}
```

The full surrounding context for reference — your insertion goes between the snap logic and the push:

```js
  // Snap to grid if enabled
  if (state.sequencer.snap) {
    const gridSize = LOOP_LENGTH / GRID_DIVISIONS;
    time = Math.round(time / gridSize) * gridSize;
    if (time >= LOOP_LENGTH) time = 0;
  }

  // Auto-start the drone when a note is added while stopped   <-- INSERT HERE
  if (!state.isPlaying) {
    await startDrone();
    const playBtn = document.getElementById('play-btn');
    if (state.isPlaying) {
      playBtn.classList.add('playing');
      playBtn.setAttribute('aria-label', 'Pause drone');
    }
  }

  // Add note
  state.sequencer.notes.push({
    id: state.sequencer.nextNoteId++,
    note,
    time
  });
```

**Why before the push:** `startDrone()` initialises `state.sequencer.loopStartTime`. If we push the note first and then start, the just-added note has a `time` value that was calculated against a `loopStartTime` of 0 (the pre-start default), which may be incorrect. Starting first ensures `loopStartTime` is set before the note is added and the scheduler begins.

**Step 2: Verify in browser**

1. Open `index.html` — drone is stopped (play button shows `●`)
2. Press any key on the on-screen keyboard (e.g. `A` for C3)
3. Confirm: the drone starts (play button switches to active state, audio begins)
4. Confirm: the note appears in the sequencer grid
5. Confirm: pressing the play button manually still toggles stop/start as before

**Step 3: Commit**

```bash
git add js/main.js
git commit -m "feat(sequencer): auto-start drone when a note is added"
```
