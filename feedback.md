I'm working on an ambient drone generator, which outputs drone sounds in the style of
fred again. I'd like iterate on the current version based to improve the output.

the current app has two tabs:
1. 'easy', a quick drone with simple controls.
2. 'create', includes several layers of sounds, a sequencer, and granular controls. 

for this iteration, I'd like to focus on the create tab. once that's in a good place, we can use those improvements as a basis for improving the the easy tab. 

in the current signal chain:
- the granular settings add an unpleasant choppiness or stuttering sound. my gut is to remove it entirely. for now, turn it off by default
- if I set the modulation too high, the sound fades in and out. it's either too aggressive or should be off by default
- a fundamental quality fred again-style drones is a long reverb, up to 20 seconds. the current reverb slider has more abstract labels. the maximum setting  doesn't feel like it goes far enough. I'd like to try the current slider with a time-based slider that starts at 0s and ends at 60s. maybe snaps to 1s increments

once these changes are in place, I'll test it again and provide more feedback if needed.

Before you start, feel free to ask any questions that would help you deliver a great result.
