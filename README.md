# Assault Revamped

A revamped remake of **Namco's 1988 arcade *Assault***, the top-down tank shooter whose whole battlefield rotates around your tank. It's written in plain HTML5 canvas and JavaScript, with no build step and no image or audio files. Every map tile, sprite, 3D model and sound effect is generated in code.

You pick one of two views on the start screen. Press **V** during play to swap between them at any time.

| View | Look |
|------|------|
| **Classic** | The arcade presentation. A 288×224 pixel playfield (the original board's resolution) rotates around the tank with nearest-neighbour sampling, the way the System 2 rotation hardware did. It has pixel-art tanks, turrets, mortars, helicopters and fortresses, a `1UP / HI-SCORE / TIME` HUD in a pixel font, and CRT scanlines with bloom. |
| **2.5D** | A chase camera behind the tank that turns with it. The ground is drawn Mode-7 style, one perspective-scaled strip per scanline. Walls, blocks, trees, the fortress and every unit are raised as 3D shapes, depth-sorted and shaded. It adds cast shadows, floor lighting, particles, fog and a panoramic sky. |

## Play

Serve the folder over HTTP and open it in a browser:

```bash
python -m http.server 8765
# then open http://127.0.0.1:8765
```

Opening `index.html` directly from disk also works.

### Controls

| Action | Keyboard | Gamepad |
|--------|----------|---------|
| Drive forward / reverse | ↑ ↓ / W S | Left stick / D-pad |
| Turn | ← → / A D | Left stick / D-pad |
| Fire cannon | Space / J | A / RT |
| Power Wheelie (grenade) | Shift / K | B / Y / LT |
| Roll left / right | Q / E | LB / RB |
| Swap view | V | — |
| Pause | P / Esc | Start |
| Sound | M | — |

Touch devices get an on-screen d-pad plus FIRE, NADE and roll buttons.

### Rules

- Each **area** is a long battlefield that ends in an enemy **fortress**. Reach it and destroy it before the **timer** runs out. A **flashing arrow** points you toward the fortress.
- The fortress has four guns. Destroy all of them to **expose the core**, then destroy the core to clear the area. You get a time bonus for whatever time is left.
- Enemies are tanks, rotating gun turrets, mortars that lob shells at a marked target, and helicopters that fly over walls.
- Your cannon shots can knock down enemy shells, but not red plasma.
- A **Power Wheelie** rears the tank up and lobs a grenade over walls. The blast also destroys crates and trees.
- **Rolling** sideways dodges incoming fire.
- Driving onto a **lift zone** raises you into the air. While you're up there you can't be hit by ground fire, the view zooms out, and your fire button drops bombs. Each lift zone works once.
- **Jump pads** launch you over the next barrier. Your landing sends out a shockwave.
- Areas cycle through desert, mechanical base, forest and river themes, and get longer and more heavily defended as you go. Crossing a barrier sets your respawn checkpoint.

## Structure

```
index.html              page shell, start / pause / game-over modals
css/style.css           UI styling
js/game.js              stage generator + renderer-agnostic simulation + attract-mode AI
js/tiles.js             map texture painter (pixel-art tiles per theme)
js/audio.js             WebAudio synthesized sound effects
js/render-classic.js    Classic rotating pixel renderer
js/render-25d.js        2.5D chase-camera renderer (mode-7 floor + extruded geometry)
js/main.js              loop, input (keyboard/gamepad/touch), view switching
```

Both renderers read the same `Game` state and consume the same event stream, so gameplay is identical in both views. The simulation runs at a fixed 120 Hz step.

Stages are generated from a seed, so each area number always produces the same map. The generator checks that every map is passable from start to fortress, and builds a distance map that drives both the exit arrow and the attract-mode autopilot.

The high score, the last chosen view and the mute setting are saved in `localStorage`.
