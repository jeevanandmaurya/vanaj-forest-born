# VANAJ: Forest-Born

A third- and first-person survival game in the browser, set in **Pench Tiger Reserve** (Seoni, Madhya Pradesh), the real forest behind Kipling's Mowgli stories.

A boy who was lost in a flood at three has grown up alone in the jungle. He doesn't know whether anyone like him exists. Over four seasons he learns to survive, talks to and fights the animals around him, follows clues left by humans, and in the end walks into a Gond village and finds the grandmother who lost him.

Everything is generated in code at load time: terrain, trees, animals, people, textures, sound and music. There are no downloaded models, images or audio files.

![Tiger and chital, first person](docs/screenshots/tiger-and-chital-fpp.jpg)
![Monsoon rain at a waterhole](docs/screenshots/monsoon-waterhole-tpp.jpg)
![Night, carrying a torch](docs/screenshots/night-torch-tpp.jpg)

## Run it

ES modules need a web server; opening `index.html` straight from disk won't work.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static host works too (GitHub Pages, Netlify, etc.). Use a recent Chrome, Edge or Firefox with WebGL2. Headphones help: the sound is spatial.

URL options: `?q=low|medium|high|ultra` sets quality, `&pr=1` caps the pixel ratio.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Shift | Sprint |
| C | Crouch (stealth) |
| Space | Jump; with block held, dodge |
| Left mouse | Attack; hold to draw the bow |
| Right mouse | Block; aim a spear throw |
| E | Interact, gather, drink, skin |
| F | Finish a wounded animal |
| Q (hold) | Call wheel: hum, langur cough, roar, whistle, flute |
| V | Switch first / third person |
| 1–6 | Fists, knife, club, spear, bow, torch |
| T | Torch on/off |
| Tab | Pouch and crafting |
| J | Journal and lore |
| M | Map |
| H / B | Bind a wound / eat |
| Esc | Pause |

## The story

13 chapters in four acts, one per season:

- **Act I · Winter** — Fog on the Teak · The Wire · Alone
- **Act II · Summer** — The Burning Months · Cut Wood · The Shadow on the Rocks
- **Act III · Monsoon** — First Rain · Chingari · The Old Flood
- **Act IV · After the Rains** — The Tower · The Flute · Torn-Ear
- **Epilogue** — The Name in the Steel

The fight with Torn-Ear, the old tiger, ends with a choice to kill him or spare him. The choice doesn't change the ending; it only shows who the player is.

## What's in it

- **World**: a 4 km × 4 km landscape built from the real place: the Pench river, a reservoir, waterholes, rocky ridges, open grassland, bamboo brakes, termite mounds and a village. It streams in 64 m chunks with distance-based detail.
- **Plants**: teak, mahua, saja, kulu, palash, arjun, banyan, bamboo and lantana. Each is grown procedurally and drawn with instancing, with wind sway, seasonal leaf fall and flowering.
- **Sky and weather**: the sun follows its real path at 21.7° N for each season. There are clouds, a moon and stars, height fog, haze, mist, rain, storms and lightning; streams and waterholes rise in the monsoon.
- **Animals**: tiger, leopard, dhole, wolf, sloth bear, gaur, sambar, chital, wild boar, grey langur, peafowl, mugger crocodile, village cows and dogs. Each species has its own procedural body and coat shader. Behaviour includes herds, packs that circle their prey, langur troops in the trees, an alarm-call network, ambushes from the water and a companion who follows you.
- **Survival and combat**: hunger, thirst, bleeding, sickness and fire. You craft a knife, club, spear, bow, arrows, torch and flute. Fighting includes blocking, parrying, dodging and finishing moves; arrows and spears stay stuck in whatever they hit; there are blood decals, limping animals and skinning.
- **Sound**: Web Audio with spatial (HRTF) panning and reverb. Birds, animal calls, footsteps for each surface, impacts and thunder are all synthesised.
- **Music**: models of real instruments, with no synth pads: bansuri flute, tanpura with its buzzing *jawari* bridge, the Pardhan *bana* fiddle, and the Baiga *mandar* drum, plus timki and manjira. Exploration music follows the raga cycle of the day (Bhairav at dawn through Malkauns past midnight, Megh in the monsoon). Fights switch to a Keherwa drum cycle.

## Code layout

About 7,800 lines of JavaScript on top of [three.js](https://threejs.org) r170 (MIT, bundled in `lib/`).

```
index.html            UI: menus, HUD, panels
js/main.js            boot, render pipeline, game loop, input, interactions, save/load
js/core/              noise, shared shader code (fog, wind), mesh merging
js/world/             terrain, flora, sky, weather, water, effects, props, procedural textures
js/actors/            animals (rigs, coats, AI), humanoid rig and animation, player
js/audio/             sound engine, music engine
js/game/              story chapters, items and crafting, UI logic, lore
```

## Limitations

- Animals and people are procedural rigs animated in code, not motion-captured, so they look stylised up close.
- Pointer lock can be refused inside sandboxed frames. If the mouse doesn't lock, move the cursor to the screen edge to turn.
- Progress saves to your browser's localStorage.
