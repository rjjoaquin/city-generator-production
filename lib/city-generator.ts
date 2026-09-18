import seedrandom from 'seedrandom'
import { clamp } from './city/geometry'
import { buildTerrain, type Terrain } from './city/envelope'
import { generateRoadGraph, generateFallbackSkeleton } from './city/roadGenerator'
import { extractBlocks } from './city/blockExtractor'
import { generateParcels } from './city/parcelGenerator'
import { assignZoning } from './city/zoningGenerator'
import { generateBuilding } from './city/buildingGenerator'
import { computeDiagnostics, validateCity } from './city/validation'
import type { Block, Building, City, CityConfig, CityPreset, Parcel, Point, Road, RoadGraph } from './city/types'

export type { CitySize, Zone, District, RoadType, LocalPattern, Point, Road, Block, Parcel, Building, City, CityPreset, CityConfig, GenerationDiagnostics } from './city/types'
export { presets, defaultConfig } from './city/types'
import { presets } from './city/types'

export function interpretPrompt(prompt: string, config: CityConfig): CityConfig {
  const next = { ...config }; const text = prompt.toLowerCase()
  if (text.includes('park')) next.parkRatio = clamp(next.parkRatio + .12)
  if (text.includes('chaotic') || text.includes('random')) next.roadRandomness = clamp(next.roadRandomness + .22)
  if (text.includes('grid')) next.gridBias = clamp(next.gridBias + .25)
  if (text.includes('dense downtown') || text.includes('denser downtown')) next.downtownDensity = clamp(next.downtownDensity + .15)
  if (text.includes('suburb')) next.suburbanDensity = clamp(next.suburbanDensity + .15)
  if (text.includes('coast')) next.coastlineEnabled = true
  if (text.includes('river')) next.riverEnabled = true
  return next
}

// Pipeline: roadGenerator -> roadGraph -> blockExtractor -> zoningGenerator -> parcelGenerator -> buildingGenerator.
// Zoning runs before parcels/buildings (unlike the old pipeline) because parcel size and building coverage
// are both driven by district/zone, not just raw density.
function assembleCity(
  config: CityConfig, preset: CityPreset, terrain: Terrain, center: Point, mapSize: number,
  rng: () => number, graph: RoadGraph, attempt: number, usedFallback: boolean,
): City {
  const roads: Road[] = graph.edges.filter(e => e.width > 0).map((e, i) => ({ id: `road-${i}`, type: e.type, points: [graph.nodes[e.a], graph.nodes[e.b]], width: e.width }))
  const rawBlocks = extractBlocks(graph, terrain.waterPolygons, preset.cityRadius)
  const zonedBlocks = assignZoning(rawBlocks, terrain, center, rng, config)

  const parcelsByBlock = new Map<string, Parcel[]>()
  zonedBlocks.forEach(block => {
    if (block.zone === 'park') return
    parcelsByBlock.set(block.id, generateParcels(block, terrain.densityAt, rng, terrain.waterPolygons))
  })

  const buildings: Building[] = []
  const parks: Block[] = []
  zonedBlocks.forEach(block => {
    if (block.zone === 'park') { parks.push(block); return }
    const zone = block.zone
    const dens = terrain.densityAt(block.centroid.x, block.centroid.y)
    const parcels = parcelsByBlock.get(block.id) ?? []
    parcels.forEach(parcel => {
      const building = generateBuilding(parcel, zone, block.district, dens, config, rng)
      if (building) buildings.push(building)
    })
  })

  const totalParcels = [...parcelsByBlock.values()].reduce((a, p) => a + p.length, 0)
  const diagnostics = computeDiagnostics(attempt, graph, rawBlocks.length, zonedBlocks, totalParcels, buildings, usedFallback)

  return {
    seed: config.seed, size: config.size, mapSize, center, envelope: terrain.envelope,
    roads, blocks: zonedBlocks, buildings, parks, water: terrain.waterPolygons,
    stats: { roads: roads.length, blocks: zonedBlocks.length, buildings: buildings.length, parkArea: parks.reduce((a, p) => a + p.area, 0) },
    diagnostics,
  }
}

// Generation must never hand back an empty/broken city. Each attempt reseeds deterministically off the
// same user seed (":attempt-N") and is validated against the size preset's minimums; only a validated
// attempt is returned. If all procedural attempts fail, a topologically guaranteed grid skeleton (which
// cannot fail connectivity/coverage by construction) takes over for block/parcel/building generation.
const MAX_ATTEMPTS = 3

export function generateCity(config: CityConfig): City {
  const preset = presets[config.size]
  const mapSize = preset.mapSize
  const center = { x: mapSize / 2, y: mapSize / 2 }
  const seedBase = config.seed || 'CITY'

  let last: City | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const rng = seedrandom(`${seedBase}:attempt-${attempt}`)
    const terrain = buildTerrain(rng, config, center, preset.cityRadius, mapSize)
    const graph = generateRoadGraph(rng, config, preset, terrain, center)
    const city = assembleCity(config, preset, terrain, center, mapSize, rng, graph, attempt, false)
    const reasons = validateCity(city.diagnostics, preset)
    city.diagnostics.failureReasons = reasons
    last = city
    if (reasons.length === 0) return city
  }

  const rng = seedrandom(`${seedBase}:fallback`)
  const terrain = buildTerrain(rng, config, center, preset.cityRadius, mapSize)
  const graph = generateFallbackSkeleton(preset, terrain, center)
  const fallbackCity = assembleCity(config, preset, terrain, center, mapSize, rng, graph, MAX_ATTEMPTS + 1, true)
  fallbackCity.diagnostics.failureReasons = validateCity(fallbackCity.diagnostics, preset)
  // The fallback grid is deterministic-by-construction and should always clear validation; if it somehow
  // still doesn't, prefer whichever of it and the last procedural attempt got closer rather than guessing.
  if (fallbackCity.diagnostics.failureReasons.length === 0) return fallbackCity
  if (last && last.diagnostics.failureReasons.length <= fallbackCity.diagnostics.failureReasons.length) return last
  return fallbackCity
}
