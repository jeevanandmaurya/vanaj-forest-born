# VANAJ: art direction (painted look)

A hand-painted Indian jungle storybook. Big simple shapes, bright colour, soft painted detail, warm light and
coloured shadows. Inspired by classic painted animation backgrounds and Ghibli-style forests; we take the
*style* only, never any film's characters, designs or scenes. Pench stays accurate in content: real species,
real places, real seasons and weather. Only the rendering style is stylised.

## Rules

1. **Shape before detail.** A tree is 3–6 big foliage masses, not thousands of leaves. Rocks are chunky.
   Silhouettes must read at a glance.
2. **Toon light.** Three soft bands: shade, half-light, full light. One shared toon material for everything.
3. **Shadows are colours.** Blue-violet or teal in shade, warm bounce from the ground. Never grey or black.
4. **Rim light.** A soft rim of sky or sun colour on edges so forms separate from the background.
5. **Painted, not photographed.** Colour patches and brush strokes, a few hand-placed accents (flowers,
   fallen leaves). No photo textures, no fine noise everywhere.
6. **Distance fades into colour.** Painted haze tinted by the time of day, not grey fog.
7. **Ink lines on the living only.** Thin dark outlines on Vanaj, animals and villagers. Backgrounds soft.
8. **Calm motion.** Whole foliage masses sway slowly; nothing flickers or shimmers.

## Palette

The game blends between these keys by hour; the season shifts foliage, grass and ground. Values live in
`js/core/palette.js` and are the single source of truth.

| Time | Sky top | Horizon | Sunlight | Shade (sky light) | Bounce (ground) | Haze |
|---|---|---|---|---|---|---|
| Night | #0b1530 | #24345e | moon #9fb3ff | #2e5070 | #1a2228 | #2a3a66 |
| Dawn 6:00 | #4f6fb0 | #f3b38a | #ffc08a | #7d86c4 | #6a4a3a | #c9a9b4 |
| Morning 8:30 | #4a92d8 | #bfe0f2 | #fff1d6 | #8fb0e0 | #7a6448 | #b8d4e6 |
| Midday 12:00 | #3d8ee0 | #cde6f4 | #fff8e8 | #93b4e2 | #80684a | #c2dcec |
| Golden 16:30 | #5a8fd0 | #ffd49a | #ffc070 | #8a8fd0 | #8a5a38 | #f0c8a0 |
| Dusk 18:20 | #2e3d78 | #f08a6a | #ff8a5a | #6a5aa8 | #4a3040 | #b07a8a |

| Season | Feel | Foliage (shade → light) | Grass (root → tip) | Ground |
|---|---|---|---|---|
| Winter | misty mornings, teak turning | #4f7a34 → #b4c862 | #4e6b2a → #c9c96a | #a48c66 |
| Summer | burnt, bright, palash in flame | #7a6a2c → #d8c060 | #8a6a30 → #e8c878 | #c09a68 |
| Monsoon | drenched, lush | #24662a → #7ac04a | #2f6a1e → #9ad050 | #7a6448 |
| After the rains | fresh, tall gold grass | #357a2c → #9ad05a | #5a7a2a → #e8d070 | #9a7e58 |

Accents: palash flame #ff6a20, mahua cream #f0e0b0, laterite #c0603a, river teal #3a9aa0, monsoon river
#8a6a40, fire #ff8a30, fireflies #e8ff8a.

## Species silhouettes

| Species | Shape |
|---|---|
| Teak | tall straight trunk, big umbrella of broad clumps |
| Mahua | short thick trunk, wide low dome |
| Saja | very tall, narrow, clumps stacked up the trunk |
| Kulu | crooked pale white "ghost" trunk, few small clumps |
| Palash | small twisted tree; flame-red flower clumps in summer |
| Bamboo | clump of stems with feathery leaning tufts |
| Banyan | huge spreading dome, hanging aerial roots |
| Dead | bare grey snag |

## Review

Every change is judged on the fixed photo set (den clearing, forest walk, waterhole, village, Vanaj and tiger
close-ups) at golden hour, midday and night, and on frame time: 60 fps Medium on the RTX 3050 at 1080p,
30 fps Low on integrated graphics.
