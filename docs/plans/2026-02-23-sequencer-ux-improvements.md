# Sequencer UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Three sequencer UX improvements: visible clear button (replacing SNAP toggle), card-deck stacking for notes that pile up in the same grid slot, and auto-unmute when a note is added.

**Architecture:** Pure CSS/JS changes to `styles.css`, `index.html`, and `js/main.js`. No new files needed. The card-deck stacking replaces the existing `assignNoteRows` row-spreading logic with a column-grouping approach: notes at the same 16th-note slot are positioned at the same horizontal position with a small (6px) vertical offset per note, creating a deck-of-cards visual. All other notes continue to use the existing up-to-3-row spread.

**Tech Stack:** Vanilla JS, CSS, HTML (no build tools, no frameworks)

---

## Context

- `index.html` line 179–183: sequencer layer header contains the SNAP toggle (`<label class="quantize-toggle">`) and the clear button (`<button class="layer-clear" hidden>`)
- `styles.css` line 444–446: `.layer-clear { display: none }` — this CSS rule hides the clear button even when JS removes the `hidden` attribute; there is no sequencer-specific override
- `styles.css` line 519–539: `.quantize-toggle` styles
- `js/main.js` line 82: `state.sequencer.snap = true` (always-on default)
- `js/main.js` line 725–730: snapToggle event listener — to be removed
- `js/main.js` line 772–813: `addNote()` — needs auto-unmute
- `js/main.js` line 825–880: `updateSequencerUI()` — renders note blocks
- `js/main.js` line 882–904: `assignNoteRows()` — spread-across-rows logic to be replaced with card-deck grouping
- `js/main.js` line 840–863: note block creation loop — positioning logic to update
- Grid is 120px tall; note blocks are 32px tall; current rows at top offsets 7px, 45px, 83px

---

### Task 1: Remove SNAP toggle from UI, fix clear button visibility

**Files:**
- Modify: `index.html` lines 179–182
- Modify: `styles.css` lines 444–446 and 519–539

**Step 1: Remove the SNAP toggle label from the HTML**

In `index.html`, delete lines 179–182 (the `<label class="quantize-toggle">` block):

```html
<!-- REMOVE this block entirely: -->
<label class="quantize-toggle">
  <input type="checkbox" id="quantize-toggle" checked>
  <span class="toggle-label">Snap</span>
</label>
```

The `<button class="layer-clear" data-layer="2" ...>` on line 183 stays. Also remove the `hidden` attribute from that button so it is visible by default (JS will re-add `hidden` when there are no notes):

```html
<button class="layer-clear" data-layer="2" aria-label="Clear sequencer">&times;</button>
```

**Step 2: Fix the CSS so the clear button is visible in the sequencer layer**

In `styles.css`, the rule at line 444–446 hides ALL `.layer-clear` elements:

```css
/* Hidden — JS still references these elements */
.layer-name,
.layer-clear {
  display: none;
}
```

Add an override specifically for the sequencer layer's clear button, right after the existing `.sequencer-layer .layer-name` block (around line 456). Also style it to match the synth's aesthetic:

```css
.sequencer-layer .layer-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.125rem;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: color var(--transition);
}

.sequencer-layer .layer-clear:hover {
  color: var(--text);
}
```

**Step 3: Remove the quantize-toggle CSS** (it is no longer used in the UI)

Delete the `.quantize-toggle` block from `styles.css` lines 519–539:

```css
/* DELETE these rules: */
.quantize-toggle { ... }
.quantize-toggle input { ... }
.quantize-toggle .toggle-label { ... }
.quantize-toggle input:checked + .toggle-label { ... }
```

**Step 4: Verify in browser**

Open `index.html` in a browser. Confirm:
- SNAP label is gone from the sequencer header
- The `×` clear button is NOT visible when no notes exist (JS hides it via `hidden` attribute on load via `updateSequencerUI`)
- After adding a note via the keyboard, the `×` button appears in the header
- Clicking `×` clears all notes

**Step 5: Commit**

```bash
git add index.html styles.css
git commit -m "feat(sequencer): replace SNAP toggle with visible clear button"
```

---

### Task 2: Remove SNAP toggle from JS

**Files:**
- Modify: `js/main.js`

**Step 1: Remove the snapToggle event listener**

In `main.js`, find and delete lines 725–730 (the `snapToggle` setup block):

```js
// DELETE this block:
const snapToggle = document.getElementById('quantize-toggle');
// ...
snapToggle?.addEventListener('change', (e) => {
  state.sequencer.snap = e.target.checked;
});
```

Note: `state.sequencer.snap` and all its usages (lines 796–799, 940–942) stay in place — snap is now a permanent `true` default. No other JS changes needed.

**Step 2: Verify in browser**

Open `index.html`. Confirm no JS errors in the console. Notes should still snap to 16th-note grid positions when added or dragged.

**Step 3: Commit**

```bash
git add js/main.js
git commit -m "refactor(sequencer): remove snap toggle, snap always enabled"
```

---

### Task 3: Auto-unmute sequencer when a note is added

**Files:**
- Modify: `js/main.js` — `addNote()` function around line 808

**Step 1: Add auto-unmute to `addNote()`**

In `addNote()`, after `state.sequencer.notes.push(...)` (around line 807) and before `updateSequencerUI()` (line 809), insert:

```js
// Auto-unmute when first note is added
if (state.sequencer.muted) {
  state.sequencer.muted = false;
}
```

The full surrounding context for reference:

```js
// Add note
state.sequencer.notes.push({
  id: state.sequencer.nextNoteId++,
  note,
  time
});

// Auto-unmute when first note is added
if (state.sequencer.muted) {
  state.sequencer.muted = false;
}

updateSequencerUI();
```

**Step 2: Verify in browser**

1. Add at least one note so the sequencer has content
2. Click the `S1` toggle to mute the sequencer (toggle goes to off state)
3. Press a key on the keyboard to add another note
4. Confirm the sequencer auto-unmutes (S1 toggle returns to on state, `has-content` class present)

**Step 3: Commit**

```bash
git add js/main.js
git commit -m "feat(sequencer): auto-unmute when a note is added"
```

---

### Task 4: Card-deck stacking for notes at the same grid position

**Files:**
- Modify: `js/main.js` — `assignNoteRows()` and `updateSequencerUI()` note block loop
- Modify: `styles.css` — add `.note-block.stacked` style

**Overview of the new stacking logic:**

The existing `assignNoteRows` spreads notes across up to 3 rows (38px apart) when they are near each other. The new logic groups notes by their quantized grid slot. Notes in a group of 1 use the existing row logic (unchanged). Notes in a group of 2+ are treated as a "stack": they all share the same horizontal position, and each note in the stack is positioned 6px lower than the one above it. The topmost card (first in the stack) has the highest z-index.

**Step 1: Replace `assignNoteRows()` with a new grouping function**

Replace the entire `assignNoteRows` function (lines 882–904) with this new version:

```js
function assignNoteRows(notes) {
  const rowMap = new Map();         // noteId -> { row, stackIndex, stackSize }
  const gridSize = LOOP_LENGTH / GRID_DIVISIONS;

  // Group notes by their quantized grid slot
  const groups = new Map(); // slotKey -> [note, ...]
  notes.forEach(note => {
    const slot = Math.round(note.time / gridSize);
    if (!groups.has(slot)) groups.set(slot, []);
    groups.get(slot).push(note);
  });

  // For single-note groups: spread across up to 3 rows (existing behavior)
  // For multi-note groups: mark as stacked
  const sortedNotes = [...notes].sort((a, b) => a.time - b.time);
  const rowOccupancy = []; // track which times are in each row

  sortedNotes.forEach(note => {
    const slot = Math.round(note.time / gridSize);
    const group = groups.get(slot);

    if (group.length > 1) {
      // Stacked group: assign stack index in order of note id
      const stackIndex = group.indexOf(note);
      rowMap.set(note.id, { row: -1, stackIndex, stackSize: group.length });
      return;
    }

    // Single note: assign to first available row (existing spread logic)
    let row = 0;
    while (row <= 2) {
      const conflict = sortedNotes.some(other => {
        if (other.id === note.id) return false;
        const otherInfo = rowMap.get(other.id);
        if (!otherInfo || otherInfo.row !== row) return false;
        return Math.abs(other.time - note.time) < gridSize * 2;
      });
      if (!conflict) break;
      row++;
    }
    if (row > 2) row = 0;
    rowMap.set(note.id, { row, stackIndex: -1, stackSize: 1 });
  });

  return rowMap;
}
```

**Step 2: Update the note block positioning in `updateSequencerUI()`**

In `updateSequencerUI()`, the note block creation loop (lines 838–863) currently reads:

```js
const row = noteRows.get(noteData.id) || 0;
const topOffset = 7 + row * 38;
block.style.left = `calc(${leftPercent}% + 2px)`;
block.style.top = `${topOffset}px`;
```

Replace those lines with:

```js
const info = noteRows.get(noteData.id) || { row: 0, stackIndex: -1, stackSize: 1 };
let topOffset;
if (info.stackIndex >= 0) {
  // Card-deck stack: center the stack vertically, offset each card by 6px
  const stackBaseTop = Math.round((120 - 32) / 2) - Math.round((info.stackSize - 1) * 3);
  topOffset = stackBaseTop + info.stackIndex * 6;
  block.classList.add('stacked');
  block.style.zIndex = info.stackSize - info.stackIndex;
} else {
  topOffset = 7 + info.row * 38;
}
block.style.left = `calc(${leftPercent}% + 2px)`;
block.style.top = `${topOffset}px`;
```

**Step 3: Add `.note-block.stacked` CSS**

In `styles.css`, after the `.note-block` block (around line 628), add:

```css
.note-block.stacked {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
```

This is intentionally minimal — the main visual effect comes from the z-index and top-offset positioning set by JS.

**Step 4: Verify in browser**

1. Open `index.html` and start audio
2. Press the same key 4+ times quickly (or press multiple keys while stopped, which places them on adjacent grid slots — then drag 3–4 to the same slot)
3. Confirm notes at the same grid slot appear as a fanned card deck (each card slightly lower than the previous)
4. Confirm notes at different grid slots are unaffected (still spread across rows as before)
5. Confirm each card in a stack is still individually draggable and deletable (hover shows `×` on top card)
6. Confirm stacks look visually clean at the grid's 120px height

**Step 5: Commit**

```bash
git add js/main.js styles.css
git commit -m "feat(sequencer): card-deck stacking for notes at same grid position"
```

---

## Done

After all four tasks, run a final smoke test:
1. Start audio, add notes to the sequencer — clear button appears
2. Mute the sequencer, add a note — auto-unmutes
3. Stack 4+ notes at the same position — card deck appears
4. No JS console errors
5. Notes snap to grid correctly when added or dragged
