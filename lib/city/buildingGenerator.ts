import type { Building, CityConfig, District, Parcel, Zone } from './types'
import { clamp, lerp } from './geometry'

// Places at most one building per parcel, sized and skipped probabilistically by zone/district and local
// density — downtown runs bigger, taller, and near-fully covered; suburbs leave visibly more open yard
// space per lot. `seed` carries a stable per-building random value forward for deterministic texture detail.
export function generateBuilding(parcel: Parcel, zone: Zone, district: District, dens: number, config: CityConfig, rng: () => number): Building | null {
  const coverage = district === 'downtown' ? 0.9
    : zone === 'industrial' ? 0.6
    : zone === 'commercial' ? 0.7
    : lerp(clamp(config.suburbanDensity + 0.15), clamp(config.downtownDensity + 0.1), dens)
  if (rng() > coverage) return null

  const footScale = district === 'downtown' ? 0.78 + rng() * 0.15
    : zone === 'industrial' ? 0.7 + rng() * 0.15
    : 0.55 + dens * 0.3 + rng() * 0.1
  const bw = Math.max(6, parcel.width * footScale * (0.85 + rng() * 0.3))
  const bh = Math.max(6, parcel.height * footScale * (0.85 + rng() * 0.3))
  const cx = parcel.x + parcel.width / 2, cy = parcel.y + parcel.height / 2

  const floors = district === 'downtown' ? Math.round(5 + dens * 14 + rng() * 6)
    : zone === 'industrial' ? 1 + Math.floor(rng() * 3)
    : zone === 'commercial' ? Math.round(2 + dens * 6 + rng() * 3)
    : Math.round(1 + dens * 3 + rng() * 3)

  return {
    id: `building-${parcel.id}`, x: cx - bw / 2, y: cy - bh / 2, width: bw, height: bh, zone, angle: parcel.angle,
    floors, seed: Math.floor(rng() * 1e6),
  }
}
