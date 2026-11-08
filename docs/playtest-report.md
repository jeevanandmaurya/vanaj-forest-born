# VANAJ play-test report (painted build)

Strict tester pass on the painted build (branch `stylized`), RTX 3050 laptop, browser pane. Each finding says what
I saw or measured, why it matters, and the fix. Research sources are listed at the end and cited by number.

## 1. Loading and menu ↔ game (critical)

| Finding | Measured | Fix |
|---|---|---|
| "Quit to title" calls `location.reload()` | the whole game rebuilds: textures, terrain, trees, rigs (10–20 s) | return to the title in place; the world stays loaded |
| Starting a chapter blocks the page | `startGame` 0.9 s, then the first frame 1.9 s compiling 14 new shader programs (animals, NPCs) | warm every program at boot with a real composer render, in the same render-target conditions [8] |
| Story teleports force-rebuild streaming in one task | part of the 0.9 s | spread chunk builds over frames behind the fade |

## 2. Sound

| Finding | Why it is wrong | Fix |
|---|---|---|
| Looping noise beds (wind, river, rain, fire, underwater) are 4 s buffers that loop with no crossfade | brown noise jumps at the seam: a click every 4 s, heard as "extra noise" | crossfade the buffer's ends so the loop is seamless |
| Wind and leaf hiss never go silent (floor 0.05 / 0.012) | a constant broadband hiss under everything | quiet floor, gusts that come and go |
| Running footsteps fire at `speed / 0.7` per second | walking 3.4 m/s = 4.9 steps/s; sprinting = 6.3 steps/s (real: ~2.4 jog, ~3.3 sprint). Machine-gun noise, not in step with the feet | trigger a step when an animated foot plants; heel + toe layers whose gap shrinks with speed, heavier low end when running, no-repeat variation [5] |
| Leaf footstep = 3–6 bursts of 2–5 kHz white noise | harsh hiss rather than a crunch | low thump + short soft crunch, quieter, less reverb |
| "Breathing" is pink noise pulsed at 0.8 Hz | a pumping hiss whenever stamina drops | discrete inhale/exhale breaths tied to the stride, only when winded |
| Every sound sends 0.35 into a noise-based reverb | footsteps smear | footsteps and UI send almost nothing |
| Gain changes jump instantly in places | clicks [6] | ramp all gains |

## 3. Water

- Painted water reads well: teal depth shading, moving ripple lines.
- Shore foam is a wide white band on gentle banks; it reads as snow or paper. It should be a thin lapping line [4].
- Ripple lines are too dense and busy for the calm painted style.

## 4. Map

- Unexplored land is near-black, so the map is mostly unreadable.
- The panel overflows the screen with both scrollbars; on a phone it is unusable.
- It still uses the old grey relief style, not the painted look; no legend; Kaali and the objective aren't clearly marked.
- Fix: an illustrated parchment map in the palette's colours (forest, grass, river, rock, village), soft fog over the unexplored
  parts that still shows the land's shape, fitted to the screen, with objective, Kaali and places marked.

## 5. Movement and animation (the biggest gap)

- **No tree climbing and no swinging.** For a Mowgli story set in a forest, this is the core fantasy, and it's missing.
  The only climb is a scripted ladder that slides the body with no climbing pose.
- Only 8 animation clips (idle, walk, jog, sprint, crouch, jump, punch, death). No climb, hang, land, vault or roll.
- Body turning and speed changes are plain lerps, so starts, stops and turns snap. Springs give smooth, physical-feeling
  motion [3].
- Jump is a small hop with no anticipation, landing weight or squash.
- **Plan:** a canopy movement system, based on how Gibbon: Beyond the Trees did brachiation [1]:
  - Climb any big trunk freely: up, down and around it.
  - Step out onto thick limbs.
  - Hang from branches and vines, swing as a pendulum about the hand, release into a ballistic leap.
  - Catch the next handhold when your reach arm is roughly perpendicular to your velocity.
  - Hold to grab, release to let go: the one-touch scheme of vine-swinging games [2], which also works on a phone.
  - Poses are procedural (arms reach the grip, legs trail the swing), since no clips exist.

## 6. Trees and environment

- Trees are uniform in size; there are no giants to climb and no hanging vines to swing on.
- The canopy reads as one flat layer. Composition needs landmarks: a few huge trees and old banyans visible from afar [10].
- The winter "mist" morning barely shows in the painted look.

## 7. Story, emotion, missions

**Strengths**
- The premise is strong and specific: the flood, the lota with the scratched name, Torn-Ear's wire, Kaali.
- The four-season structure and the kill-or-mercy choice that doesn't change the ending work well.

**Problems**
- Kaali dies in chapter 2, after one shared hunt. The player hasn't bonded yet, so the loss lands as text.
  Companion attachment comes from shared play and moments, not narration [7].
- Emotion is mostly narrated ("I covered her with teak leaves") rather than played: no interaction at her body, no
  grieving beat, no memory of her later.
- Joy is missing. The Mowgli story is about belonging as well as loss: playing in the trees, racing langurs, learning the
  forest. There's no playful mission.
- Missions are mostly "go to marker, press E". The verbs are few, and checklist pacing tires players [9].

**Plan**
- A langur troop that teaches Vanaj the canopy: a chase-and-follow race through the trees.
- Shared moments with Kaali before the loss: play-fighting, resting together, her watching over you.
- A grieving interaction at her body that the player performs.
- Echoes of her later: her howl in the wind, her scent at the den.

## 8. Interface

- The narration subtitle overlaps the health bars and hotbar at the bottom of the screen.
- No touch controls at all: the game is keyboard and mouse only, with pointer lock.

## 9. Phone and performance

- About 960 draw calls and 4.8M triangles, 2048² shadows and bloom at Medium: far beyond a phone budget. Mobile guides suggest
  capping pixel ratio around 1–1.5 and cutting shadows, post effects and draw calls [11].
- No mobile quality tier and no touch input [12].

## Status after this pass

**Done and verified in the browser**
- Menu ↔ game: the start click no longer blocks (it was 0.9 s plus a 1.9 s first frame). The fade covers the work, and no new
  shaders compile on the first frame (134 programs before and after). Quit to title takes 0.3 s; it used to reload the page.
- Sound:
  - noise loops are seamless; wind and leaf beds have a near-silent floor; breaths are separate breaths;
  - footsteps fire on foot plants, at 2.25 steps/s jogging and 3.7 sprinting (was 4.9 and 6.3), as heel + toe layers;
  - volume changes are ramped.
- Water: pools sit inside a bank and are never above the ground beside them; pool levels come from the lowest rim point; the shore foam
  is a thin line on a finer mesh; reflections and ripples are calmer.
- Map: parchment illustration with a soft fog wash, a legend, Kaali and objective markers; it fits the screen.
- Canopy:
  - free trunk climbing, walking along limbs, hanging, pumping, releasing and catching on branches and lianas;
  - semal giants (with buttresses, tiered limbs and lianas) round the den and scattered through the forest;
  - leaves dissolve near the camera inside crowns.
- Motion: frame-rate independent dampers for acceleration, turning and camera; landing dip; lean into turns; head turns
  toward animals.
- Story:
  - chapter 1 gains the langurs' canopy lesson, a moment of joy ("I flew"), and sharing the meat with old Kaali;
  - chapter 2 slows and voices her death and adds sitting with her and a journal entry;
  - chapter 3 remembers her.
- Phone: touch joystick, drag-look, action buttons (Jump/Grab is hold-to-grip), Low quality by default, a HUD layout for
  narrow screens.

**Not yet done or not verifiable here**
- Sound changes were checked in code and by counting step timings; I can't hear the browser, so they need listening.
- Touch controls were tested in a 375×812 emulation only, not on a real phone; phone frame rate is unmeasured.
- Chapters 4–12 have no new emotional beats yet; the langurs in the lesson don't yet race you through the trees.
- There are still no clips for climbing or landing; tree poses are procedural. Bamboo and banyan can't be climbed.
- The HUD still has the old dark styling rather than a storybook look.

## Sources

1. Eddy Boxerman, "Deep Dive: Physics-based animation in Gibbon: Beyond the Trees", Game Developer, 2022. https://www.gamedeveloper.com/programming/deep-dive-physics-based-animation-in-gibbon-beyond-the-trees
2. Benji Bananas coverage and vine-swing control descriptions: https://www.pocketgamer.com/benji-bananas/benji-bananas-swings-over-to-ios-for-more-monkey-fun , https://allaboutwindowsphone.com/flow/item/18474_Help_Benji_swing_for_the_banan.php
3. Daniel Holden, "Spring-It-On: The Game Developer's Spring-Roll-Call". https://theorangeduck.com/page/spring-roll-call
4. Toon water with depth-based shore foam: https://code.tutsplus.com/creating-toon-water-for-the-web-part-1--cms-30447t , https://github.com/favoyang/ToonWaterShader-UPM
5. CRI, "Advanced Footsteps" (heel/toe layers, gap shrinking with speed). https://blog.criware.com/?p=3604
6. "Web Audio: the ugly click and the human ear". https://alemangui.github.io/ramp-to-value
7. "Companions: creating player bonds", Game Developer. https://www.gamedeveloper.com/design/companions-creating-player-bonds ; "Turning feelings into mechanics". https://www.gamedeveloper.com/design/turning-feelings-into-mechanics-the-narrative-design-of-apartment-a-separated-place
8. "Why a heavy three.js scene tanks PageSpeed" (first-frame program compiles, compileAsync conditions). https://discourse.threejs.org/t/why-a-heavy-three-js-scene-tanks-pagespeed-and-it-is-not-your-javascript/94734 ; three.js PR #19752 https://github.com/mrdoob/three.js/pull/19752
9. Open-world mission design: https://www.gamedeveloper.com/design/embracing-the-chaos-freedom-as-the-cornerstone-for-open-world-mission-design , https://www.gamedeveloper.com/design/ghost-of-tsushima---the-art-of-compelling-quest-design
10. Readable stylised environments and layered composition: https://80.lv/articles/making-a-jungle-environment-in-speedtree-substance-ue4
11. three.js "fluffy trees" (camera-facing foliage quads): https://javascriptweekly.com/link/131623/web ; mobile three.js tips: https://skills.sh/ovachiever/droid-tings/threejs-graphics-optimizer
12. Virtual joystick and touch camera patterns: https://coherent-labs.com/blog/uitutorials/virtual-joystick , https://cursa.app/en/page/touch-controls-for-mobile-games-input-patterns-and-feedback
13. Kipling's Jungle Book themes (belonging between two worlds, the Law of the Jungle): https://www.litcharts.com/lit/the-jungle-book/themes
