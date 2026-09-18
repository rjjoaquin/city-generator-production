import type { Block, CityConfig, Point } from './types'
import { clamp } from './geometry'
import { classifyDistrict } from './district'
import type { Terrain } from './envelope'

// Assigns each extracted block a district (downtown / inner / outer / industrial) from the same
// density+distance rule the road stage used to pick local-street patterns, then a zone within that
// district. Parks are rolled in every district so they read as distributed throughout the city, not
// clustered in one belt, but at different rates: outer neighborhoods lean greener, downtown stays built up.
export function assignZoning(blocks: Block[], terrain: Terrain, center: Point, rng: () => number, config: CityConfig): Block[] {
  return blocks.map(block => {
    const dens = terrain.densityAt(block.centroid.x, block.centroid.y)
    const angle = Math.atan2(block.centroid.y - center.y, block.centroid.x - center.x)
    const distFrac = clamp(Math.hypot(block.centroid.x - center.x, block.centroid.y - center.y) / Math.max(1, terrain.radiusAt(angle)))
    const district = classifyDistrict(dens, distFrac, rng)

    const parkChance = district === 'downtown' ? config.parkRatio * 0.35
      : district === 'industrial' ? config.parkRatio * 0.4
      : district === 'outer' ? config.parkRatio * 1.4
      : config.parkRatio
    if (rng() < parkChance) return { ...block, district, zone: 'park' as const }

    let zone: Block['zone'] = 'residential'
    if (district === 'industrial') zone = 'industrial'
    else if (district === 'downtown') zone = rng() < 0.75 ? 'commercial' : 'residential'
    else if (district === 'inner') zone = rng() < 0.3 ? 'commercial' : 'residential'
    return { ...block, district, zone }
  })
}
