import type { Block, Parcel, Point } from './types'
import { pointInPolygon, rotate } from './geometry'

// Subdivides a block's buildable (inset) polygon into lots on a grid aligned to the block's own longest
// edge, keeping only lots whose center falls inside the real polygon. Lot size is driven by district and
// zone: downtown packs tight, industrial spreads a few very large parcels, residential/commercial fall
// between the two and residential also shrinks lots as local density rises.
export function generateParcels(block: Block, densityAt: (x: number, y: number) => number, rng: () => number, waterPolygons: Point[][]): Parcel[] {
  const pts = block.buildable.length >= 3 ? block.buildable : block.points
  const c = block.centroid
  let bestLen = -1, theta = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]; const L = Math.hypot(b.x - a.x, b.y - a.y)
    if (L > bestLen) { bestLen = L; theta = Math.atan2(b.y - a.y, b.x - a.x) }
  }
  const toLocal = (p: Point) => rotate(p.x - c.x, p.y - c.y, -theta)
  const toWorld = (p: Point) => { const r = rotate(p.x, p.y, theta); return { x: c.x + r.x, y: c.y + r.y } }
  const local = pts.map(toLocal)
  const minX = Math.min(...local.map(p => p.x)), maxX = Math.max(...local.map(p => p.x))
  const minY = Math.min(...local.map(p => p.y)), maxY = Math.max(...local.map(p => p.y))

  const dens = densityAt(c.x, c.y)
  const baseLot = block.district === 'downtown' ? 18 + rng() * 10
    : block.zone === 'industrial' ? 130 + rng() * 70
    : block.zone === 'commercial' ? 45 + rng() * 25
    : 46 - dens * 22
  const lotW = Math.max(16, baseLot * (0.8 + rng() * 0.4)), lotH = Math.max(16, baseLot * (0.8 + rng() * 0.4))

  const parcels: Parcel[] = []
  let n = 0
  for (let lx = minX + 5; lx < maxX - 5; lx += lotW) {
    for (let ly = minY + 5; ly < maxY - 5; ly += lotH) {
      const cx = lx + lotW / 2, cy = ly + lotH / 2
      const wp = toWorld({ x: cx, y: cy })
      if (!pointInPolygon(wp.x, wp.y, pts)) continue
      if (waterPolygons.some(w => pointInPolygon(wp.x, wp.y, w))) continue
      parcels.push({ id: `parcel-${block.id}-${n++}`, blockId: block.id, x: wp.x - lotW / 2, y: wp.y - lotH / 2, width: lotW, height: lotH, angle: theta })
    }
  }
  return parcels
}
