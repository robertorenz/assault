# Assault Revamped

A revamped remake of **Namco's 1988 arcade *Assault***, the top-down tank shooter whose whole battlefield rotates around your tank. It's written in plain HTML5 canvas, WebGL (Three.js, vendored) and JavaScript, with no build step and no image or audio files. Every map tile, sprite, 3D model and sound effect is generated in code.

**▶ [Play it in your browser](https://robertorenz.github.io/assault/)**

![Start screen with the three view choices](docs/screenshots/menu.jpg)

Each stage is a floating island in open space, edged by puffy rock cliffs and foliage, with a stone pentagon fortress at the far end. The look follows the arcade original: a vertical screen, the pink `SCORE / TIME / TOPSCORE` HUD, a white-blue-gold tank, pink enemy tanks and bullets, and red pyramid guns around a red core.

You pick one of three views on the start screen (keys **1**, **2**, **3**). Press **V** during play to cycle through them at any time.

| 3D | 2.5D | Classic |
|:--:|:--:|:--:|
| ![3D view](docs/screenshots/view-3d.jpg) | ![2.5D view](docs/screenshots/view-25d.jpg) | ![Classic view](docs/screenshots/view-classic.jpg) |

| View | Look |
|------|------|
| **3D** | A full WebGL scene. The island is a real landmass with a rocky underside hanging over a nebula and a ringed gas giant. Boulders, trees, buildings and units are lit 3D models with soft shadows, an HDR bloom pass, explosions that throw fire, smoke, sparks and debris, a minimap, and a camera that follows the tank. Only offered when the browser supports WebGL. |
| **2.5D** | The same islands seen from a chase camera that turns with the tank. The island is drawn Mode-7 style and floats in space, with a nebula and planet behind it. Boulders, structures, fortress pyramids and every unit are raised 3D shapes, with shadows, floor lighting and particles. |
| **Classic** | The arcade presentation. A vertical 224×288 pixel screen whose island playfield rotates around the tank with nearest-neighbour sampling, over a starfield that turns with it. It uses pixel-art units, the arcade HUD, the yellow exit sign, and craters left by explosions, with CRT scanlines and bloom on top. |

Each stage theme has its own palette. Stage 3, the sand lakes, has pink rock cliffs:

<p align="center"><img src="docs/screenshots/view-3d-stage3.jpg" alt="3D view of stage 3, Sand Lakes" width="360"></p>

## Play

**Play online: https://robertorenz.github.io/assault/**

To run it locally, serve the folder over HTTP and open it in a browser:

```bash
python -m http.server 8765
# then open http://127.0.0.1:8765
```

Opening `index.html` directly from disk also works.

Add `?demo=three|modern|classic&stage=N` to the URL to skip the menu and watch the autopilot play that view and stage with the HUD on. This is how the screenshots above were taken.

### Controls

| Action | Keyboard | Gamepad |
|--------|----------|---------|
| Drive forward / reverse | ↑ ↓ / W S | Left stick / D-pad |
| Turn | ← → / A D | Left stick / D-pad |
| Fire cannon | Space / J | A / RT |
| Power Wheelie (grenade) | Shift / K | B / Y / LT |
| Roll left / right | Q / E | LB / RB |
| Cycle view (3D → 2.5D → Classic) | V | — |
| Pause | P / Esc | Start |
| Sound | M | — |

Touch devices get an on-screen d-pad plus FIRE, NADE and roll buttons.

### Rules

- Each **stage** is a floating island that ends in an enemy **fortress**. The two-digit **timer** refills every time you cross a ridge or river. A yellow **arrow sign** points you toward the fortress.
- The fortress has five red pyramid guns. Destroy all of them to **expose the core**, then destroy the core. A hole opens in the fortress ("NOW YOU ASSAULT ON NEXT STAGE!!"), and you get a bonus for whatever time is left.
- Enemies are tanks, rotating gun turrets, mortars that lob shells at a marked target, and helicopters that fly over walls.
- Your cannon shots can knock down enemy shells, but not red plasma.
- A **Power Wheelie** rears the tank up and lobs a grenade over walls. The blast also destroys bunkers and other structures.
- **Rolling** sideways dodges incoming fire.
- Driving into a blue **lift ring** raises you into the air. While you're up there you can't be hit by ground fire, the view zooms out, and your fire button drops bombs. Each lift zone works once.
- **Jump pads** launch you over the next barrier. Your landing sends out a shockwave.
- Stages cycle through five themes: highlands, jungle river, sand lakes, city block and enemy base. They get longer and more heavily defended as you go. Crossing a ridge also sets your respawn checkpoint.

## Structure

```
index.html              page shell, start / pause / game-over modals
css/style.css           UI styling
js/game.js              floating-island stage generator + simulation + attract-mode AI
js/tiles.js             terrain painter (ground noise, rock cliffs, foliage, water, city, base, fortress)
js/audio.js             WebAudio synthesized sound effects
js/render-classic.js    Classic vertical-screen rotating pixel renderer
js/render-25d.js        2.5D chase-camera renderer (mode-7 island in space + 3D geometry)
js/render-3d.js         3D WebGL renderer (Three.js scene, shadows, bloom, particles, minimap)
js/vendor/three/        Three.js r147 + EffectComposer / UnrealBloomPass (MIT)
docs/screenshots/       README images
js/main.js              loop, input (keyboard/gamepad/touch), view switching
```

All three renderers read the same `Game` state and consume the same event stream, so gameplay is identical in every view. The 3D view draws its HUD with the 2.5D renderer's panel code on a canvas layered over the WebGL canvas. The simulation runs at a fixed 120 Hz step.

Stages are generated from a seed, so each stage number always produces the same map. The generator checks that every map is passable from start to fortress, and builds a distance map that drives both the exit arrow and the attract-mode autopilot.

The high score, the last chosen view and the mute setting are saved in `localStorage`.

## History

### The original

*Assault* is a tank shooter released to arcades by **Namco in 1988**. It ran on Namco's System 2 board, and its centrepiece was hardware rotation and scaling: the whole playfield turns around your tank instead of the tank turning on a fixed map. You drove the tank with tread-style controls. Its moves were a sideways roll to dodge fire and the Power Wheelie, which lobbed a grenade over walls. It played on a vertical monitor, crossing timed stretches of terrain toward a fortress at the end of each stage.

### This remake

| Date | Version | Changes |
|------|---------|---------|
| 2026-10-04 | First build | Started as a remake of the wrong game: an Atari-style 1983 shooter, with Classic and 2.5D views over a shared fixed-step simulation, synthesized audio, keyboard / gamepad / touch input and modal screens. |
| 2026-10-04 | Rebuilt as *Assault* | Re-targeted at Namco's 1988 arcade game. Added a rotating battlefield, tank controls with rolls and the Power Wheelie, lift zones, jump pads, timed areas, a fortress with guns and a core, a seeded stage generator, the exit arrow and an attract-mode autopilot. |
| 2026-10-04 | Arcade look | Rebuilt from reference frames of the original. Stages became floating islands with puffy rock cliffs and five themes. Added the pentagon fortress with five pyramid guns, a vertical 224×288 Classic screen with the pink arcade HUD, and the two-digit timer that refills at each ridge. |
| 2026-10-04 | 3D view | Added a full WebGL view (Three.js) with lighting, shadows, bloom, debris and a minimap. The menu now offers 3D / 2.5D / Classic. Added the `?demo=` screenshot mode and README screenshots. |
| 2026-10-04 | Online | Published on GitHub Pages at https://robertorenz.github.io/assault/. |

## Credits

- **Original game:** *Assault* © 1988 Namco (now Bandai Namco Entertainment). This is an unofficial, non-commercial fan remake made as a tribute. It uses none of the original's code, graphics or sound, and it isn't affiliated with or endorsed by Bandai Namco. *Assault* and Namco are trademarks of their respective owners.
- **Remake:** Roberto Renz, built with [Claude Code](https://claude.com/claude-code) (Anthropic).
- **3D engine:** [Three.js](https://threejs.org) r147, including the EffectComposer and UnrealBloomPass add-ons. © 2010–2022 three.js authors, MIT License (see `js/vendor/three/LICENSE`).
- **Fonts:** [Orbitron](https://fonts.google.com/specimen/Orbitron) (Matt McInerney), [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (CodeMan38) and [Rajdhani](https://fonts.google.com/specimen/Rajdhani) (Indian Type Foundry), served by Google Fonts under the SIL Open Font License.
- **Art and audio:** every tile, sprite, 3D model and sound effect is generated in code at runtime.
