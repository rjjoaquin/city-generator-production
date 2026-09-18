import type { CityConfig, Point } from './types'
import { clamp, pointInPolygon, noise2 } from './geometry'

export type Terrain = {
  envelope: Point[]
  radiusAt: (angle: number) => number
  insideEnvelope: (x: number, y: number) => boolean
  inAnyWater: (x: number, y: number) => boolean
  validPoint: (x: number, y: number) => boolean
  densityAt: (x: number, y: number) => number
  waterPolygons: Point[][]
}

// The development envelope is an irregular blob (sum-of-sines radius by angle), never the canvas rectangle.
// densityAt combines distance-from-center-relative-to-the-envelope with the same noise so falloff isn't a perfect circle.
export function buildTerrain(rng: () => number, config: CityConfig, center: Point, cityRadius: number, mapSize: number): Terrain {
  const noiseSeed = rng() * 1000
  const irregularity = 0.18 + rng() * 0.12
  const envFreqs = [0, 1, 2].map(() => ({ f: 2 + Math.floor(rng() * 4), phase: rng() * Math.PI * 2, amp: 0.4 + rng() * 0.6 }))
  const radiusAt = (angle: number) => {
    let mult = 1
    for (const fr of envFreqs) mult += fr.amp * irregularity * Math.sin(fr.f * angle + fr.phase)
    return cityRadius * clamp(mult, 0.55, 1.4)
  }
  const envelope: Point[] = []
  for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; const r = radiusAt(a); envelope.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r }) }

  const waterPolygons: Point[][] = []
  if (config.riverEnabled) {
    const riverX = mapSize * (.42 + rng() * .12)
    const bank = [{ x: riverX - 20, y: 0 }, { x: riverX + 18, y: mapSize * .35 }, { x: riverX - 8, y: mapSize * .7 }, { x: riverX + 28, y: mapSize }]
    waterPolygons.push([...bank, { x: bank[bank.length - 1].x + 100, y: mapSize }, { x: bank[0].x - 100, y: 0 }])
  }
  if (config.coastlineEnabled) {
    const bank: Point[] = []
    for (let y = 0; y <= mapSize; y += 40) bank.push({ x: mapSize * .12 + Math.sin(y / 140) * 26, y })
    waterPolygons.push([{ x: -50, y: -50 }, ...bank, { x: -50, y: mapSize + 50 }])
  }

  const insideEnvelope = (x: number, y: number) => Math.hypot(x - center.x, y - center.y) <= radiusAt(Math.atan2(y - center.y, x - center.x))
  const inAnyWater = (x: number, y: number) => waterPolygons.some(poly => pointInPolygon(x, y, poly))
  const validPoint = (x: number, y: number) => insideEnvelope(x, y) && !inAnyWater(x, y)
  const densityAt = (x: number, y: number) => {
    const dist = Math.hypot(x - center.x, y - center.y)
    const r = radiusAt(Math.atan2(y - center.y, x - center.x))
    const base = clamp(1 - clamp(dist / Math.max(1, r), 0, 1.3), 0, 1)
    return clamp(base + noise2(x, y, noiseSeed) * 0.18, 0, 1)
  }

  return { envelope, radiusAt, insideEnvelope, inAnyWater, validPoint, densityAt, waterPolygons }
}
