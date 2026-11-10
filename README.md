# Lumen — a glass switch in one fragment shader

A light/dark toggle whose knob is a rounded-square glass lens. Everything inside the
canvas is WebGL: no images, no libraries, no CSS trickery.

- `index.html` — page chrome, one canvas, one focusable `role="switch"` surface
- `style.css` — typography, layout, theme-crossing text colours, no-WebGL fallback
- `script.js` — the two shader passes, pointer drag, spring easing, keyboard
- `assets/` — favicon only

## How it is drawn

Two passes per frame:

1. **World pass → off-screen texture.** Page background (cool at night, warm paper by
   day), the glassless track with its drop shadow, the light wash that runs along it,
   and the dot-matrix icon sitting where the knob is.
2. **Glass pass → screen.** The knob is a rounded square taller than the track, so it
   sits proud of it; it samples that texture with a bevel-driven refraction offset, a
   small per-channel split for chromatic aberration and a widening blur for frost.
   Then the edge light, the orbiting strip, the scatter inside and the bloom outside
   are added, and the frame is tone-mapped.

### The orbiting strip

`angle = -π/2 + t·π`, so the strip sits at the bottom of the glass at night, sweeps
around the right side as you scrub, and lands at the top by day. The same falloff
function drives the strip core, the track wash and the page spill, so the light stays
equally bold on a near-black and a near-white background — it just changes hue, from
moon-blue to amber.

### The pixel morph

Each cell of the matrix holds two states at once, paired by angle: a crescent-moon
field and a sun-with-spokes field are both sampled at the cell's *swirled* position, so
a sun pixel at angle `a + swirl` answers a moon pixel at angle `a`. Per-pixel progress
comes from a staggered wave (angle first, then radius) pushed through a damped spring,
and the cell itself shrinks and spins while it travels. Because nothing is time-based,
dragging halfway leaves the whole swarm frozen mid-flight and dragging back rewinds it
exactly.

## Controls

- Drag the knob, or tap the track
- Click / `Space` / `Enter` to toggle
- `←` `→` `Home` `End` to scrub
- `prefers-reduced-motion` drops the tween and snaps straight to the target state

## Run

Open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000
```

Live: https://chinaapps.github.io/uimoni/
