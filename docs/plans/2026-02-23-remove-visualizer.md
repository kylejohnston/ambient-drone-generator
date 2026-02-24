# Remove Visualizer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the audio-reactive canvas background visualizer entirely from the codebase.

**Architecture:** Delete `js/visualizer.js`, remove the `<canvas>` from HTML, remove the `#visualizer` CSS block, and remove the 5 lines in `js/main.js` that import, declare, initialise, start, and stop it. No other files reference the visualizer.

**Tech Stack:** Vanilla JS, HTML, CSS (no build tools)

---

## Context

All references to the visualizer live in exactly these places:

- `index.html` line 10: `<canvas id="visualizer" aria-hidden="true"></canvas>`
- `styles.css` lines 69–78: `/* Visualizer Canvas */` comment + `#visualizer { ... }` rule
- `js/main.js` line 15: `import { Visualizer } from './visualizer.js';`
- `js/main.js` line 100: `let visualizer = null;`
- `js/main.js` lines 225–226: two-line init block inside `init()` (`const canvas = ...` + `visualizer = new Visualizer(canvas)`)
- `js/main.js` line 1391: `visualizer.start();` inside `startDrone()`
- `js/main.js` line 1418: `visualizer?.stop();` inside `stopDrone()`
- `js/visualizer.js`: the entire file

---

### Task 1: Remove visualizer from HTML and CSS

**Files:**
- Modify: `index.html` line 10
- Modify: `styles.css` lines 69–78

**Step 1: Remove the `<canvas>` element from `index.html`**

Delete line 10:
```html
  <canvas id="visualizer" aria-hidden="true"></canvas>
```

**Step 2: Remove the `#visualizer` CSS block from `styles.css`**

Delete lines 69–78 (the comment and the rule):
```css
/* Visualizer Canvas */
#visualizer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}
```

**Step 3: Verify**

Open `index.html` in a browser. Confirm: no JS errors in the console (the JS will error because the import still exists — that is expected and will be fixed in Task 2). The canvas background is gone.

**Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "refactor: remove visualizer canvas from HTML and CSS"
```

---

### Task 2: Remove visualizer from JS and delete the file

**Files:**
- Modify: `js/main.js` — 5 lines across 4 locations
- Delete: `js/visualizer.js`

**Step 1: Remove the import (line 15)**

Delete this line from `js/main.js`:
```js
import { Visualizer } from './visualizer.js';
```

**Step 2: Remove the module-level declaration (line 100, after Task 1 edits shift line numbers)**

Find and delete:
```js
let visualizer = null;
```

**Step 3: Remove the init block (inside `init()`, around lines 225–226)**

Find and delete these two lines inside `init()`:
```js
  const canvas = document.getElementById('visualizer');
  visualizer = new Visualizer(canvas);
```

The `init()` function should now proceed directly to `bindControls()` after its opening.

**Step 4: Remove `visualizer.start()` from `startDrone()`**

Find and delete:
```js
  visualizer.start();
```

**Step 5: Remove `visualizer?.stop()` from `stopDrone()`**

Find and delete:
```js
  visualizer?.stop();
```

**Step 6: Delete `js/visualizer.js`**

```bash
rm "js/visualizer.js"
```

**Step 7: Verify**

Open `index.html` in a browser. Confirm:
- No JS errors in the console
- Drone starts and stops correctly when the play button is clicked
- Background is a flat dark color (`#161513`) — no animation

**Step 8: Commit**

```bash
git add js/main.js
git rm js/visualizer.js
git commit -m "refactor: remove visualizer JS entirely"
```
