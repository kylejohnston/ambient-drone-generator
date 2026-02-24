# Remove Visualizer — Design

**Goal:** Delete the audio-reactive canvas background visualizer entirely.

**Design:** Remove the `<canvas>` element from HTML, the `#visualizer` CSS rule, the `visualizer.js` file, and the 5 lines in `main.js` that import, initialise, start, and stop it. No other code references the visualizer.
