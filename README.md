# Nova City

A procedural city playground built with Next.js, React, TypeScript, and HTML Canvas. Turn a seed into a fictional city, adjust its character, and explore its roads, neighborhoods, parks, and buildings.

[See how it works](https://city-generator.rjwebdeveloper.com).

City generation uses seeded randomness and geometric rules. The prompt box recognizes a small set of keywords; it does not use an AI service or require an API key.

## Features

- **Repeatable generation:** reproduce a city with the same seed, full configuration, and generator version.
- **Three city sizes:** explore small, medium, and large layouts.
- **Adjustable settings:** control road randomness, downtown density, park ratio, and rivers.
- **Distinct land uses:** residential, commercial, industrial, and park areas with parcel-based buildings.
- **Terrain and roads:** irregular development boundaries, water, and arterial, collector, and local streets.
- **Interactive map:** drag to pan, scroll to zoom, and fit the city to the viewport.
- **Generation diagnostics:** inspect connectivity, blocks, parcels, buildings, validation notes, and fallback usage.

## Quick start

Use Node.js 22 or newer and npm. From this repository's root:

```bash
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000).

No environment variables, database, or external generation service are needed. If you are running this copy inside its parent project, first run `cd public-city-generator`.

A pnpm lockfile is also included for contributors who prefer pnpm. Use one package manager consistently and keep its lockfile in sync when changing dependencies.

## Explore a city

1. Choose **Small**, **Medium**, or **Large** to generate a layout at that scale.
2. Open **Settings** to enter a seed and adjust the sliders or river toggle, then select **Apply settings**.
3. Select **Generate** to regenerate with the current settings, or **Randomize** to generate with a new seed.
4. Drag the map to pan. Scroll or use **+ / −** to zoom. Select **Fit city** to frame the map.
5. Open **Diagnostics** to inspect the generated layout and any validation notes.

A seed alone does not capture every setting. Save the configuration alongside the seed if you want to recreate a layout. The interface does not currently persist settings across page reloads or provide map exports.

### Supported prompts

Enter a phrase in **Describe a change** and press Enter or select the sparkle button.

| Example | Effect |
| --- | --- |
| `more parks` | Increases the park ratio |
| `chaotic streets` or `random roads` | Increases road randomness |
| `grid city` | Increases the grid bias |
| `dense downtown` or `denser downtown` | Increases downtown density |
| `more suburbs` | Increases suburban density |
| `coastal city` | Enables the coastline |
| `add a river` | Enables the river |

Prompts match keywords, ignoring capitalization. Multiple matches can apply together, and repeated prompts can increase settings until their limits are reached. Unrecognized text leaves settings unchanged. Negation is not understood: `no parks` still matches `park` and increases the park ratio.

## How generation works

The generator builds terrain and a development boundary, creates a road graph, traces blocks, assigns zoning, subdivides parcels, and places buildings. The canvas renders the resulting city data.

Each procedural attempt is validated against the selected size's targets. Generation tries up to three deterministic attempts before trying a fallback road skeleton. If validation still fails, the generator returns the fallback or last procedural result based on its validation failures; the diagnostics panel exposes those notes.

The generator can also be called directly from TypeScript:

```ts
import { defaultConfig, generateCity } from './lib/city-generator'

const city = generateCity({
  ...defaultConfig,
  seed: 'MY-FIRST-CITY',
  size: 'medium',
  parkRatio: 0.2,
  riverEnabled: true,
})

console.log(city.stats, city.diagnostics)
```

`CityConfig` and the other shared types are defined in [`lib/city/types.ts`](lib/city/types.ts).

## Project structure

```text
app/
  page.tsx              Map renderer, controls, and dialogs
  layout.tsx            Page metadata and application layout
  globals.css           Application styles
lib/
  city-generator.ts     Generation pipeline and prompt interpretation
  city/                 Terrain, geometry, roads, blocks, zoning,
                        parcels, buildings, types, and validation
components/             Reusable UI components
types/                  Additional TypeScript declarations
public/                 Icons and static assets
```

## Development and deployment

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npx tsc --noEmit` | Check TypeScript types |
| `npm run build` | Create a production build |
| `npm start` | Serve the production build |

Run the type check separately: the current Next.js configuration skips TypeScript errors during production builds. There is no automated test script yet.

To run in production:

```bash
npm run build
npm start
```

Deploy this repository as a Next.js application on a host that supports its Node.js runtime. Use the repository root as the application directory. The layout includes Vercel Analytics in production; its integration lives in [`app/layout.tsx`](app/layout.tsx).

## Contributing

Keep changes focused and describe the behavior they change. Before submitting a pull request, run the type check and production build, then exercise generation, settings, prompts, and map navigation in the browser. For generator changes, check multiple seeds and all three sizes, including the diagnostics panel. Include the seed and full configuration when reporting a reproducible generation issue.
