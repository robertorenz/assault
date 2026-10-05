# Assault Revamped

A revamped remake of the 1983 arcade shooter **Assault**, written in plain HTML5 canvas and JavaScript with no build step and no image or audio files. Every sprite, model and sound effect is generated in code.

You pick one of two views on the start screen. Press **V** during play to swap between them at any time.

| View | Look |
|------|------|
| **Classic** | A 160×216 pixel buffer with chunky console sprites, a 3×5 bitmap font, 1983-style colours, scanlines, phosphor bloom and a CRT vignette. |
| **2.5D** | A perspective battlefield seen from a pitched camera that sways with the player. It has extruded tank geometry, shaded saucers, cast shadows, dynamic floor lighting, particle debris, smoke, scorch decals and a sky backdrop with a ringed planet. |

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
| Move | ← → / A D | Left stick / D-pad |
| Fire up | Space / ↑ / W | A / Y / RT |
| Fire left | Z / Q | X / LB |
| Fire right | X / E | B / RB |
| Swap view | V | — |
| Pause | P / Esc | Start |
| Sound | M | — |

Touch devices get on-screen move and fire buttons.

### Rules

- The armoured **mothership** can't be destroyed. It launches raiders until you meet the wave quota.
- Enemy types: saucers; **splitters**, which break into two fast minis; **divers**, which drop quickly; and **gunners**, which take two hits and fire aimed missiles.
- Raiders that reach the ground become **crawlers**. Only sideways fire can hit them.
- Every shot adds cannon **heat**. If heat reaches 100%, the cannon melts down and you lose a life.
- You can shoot falling bombs for 10 points each. You earn a bonus cannon every 10,000 points.
- When you clear a wave, the bonus depends on the wave number and how cool your cannon is.

## Structure

```
index.html              page shell, start / pause / game-over modals
css/style.css           UI styling
js/game.js              renderer-agnostic simulation + attract-mode AI
js/audio.js             WebAudio synthesized sound effects
js/render-classic.js    Classic pixel/CRT renderer
js/render-25d.js        2.5D perspective renderer
js/main.js              loop, input (keyboard/gamepad/touch), view switching
```

Both renderers read the same `Game` state and consume the same event stream (`explode`, `shoot`, `playerDie`, and so on), so gameplay is identical in both views. The simulation runs at a fixed 120 Hz step. The high score, the last chosen view and the mute setting are saved in `localStorage`.
