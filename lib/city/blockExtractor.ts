import type { Block, Point, RoadGraph } from './types'
import { computeFaces, insetPolygon, pointInPolygon, polygonArea, polygonCentroid, polygonPerimeter } from './geometry'

// Blocks come only from the road graph's enclosed faces — never invented independently.
// Rejects the unbounded exterior face plus anything too small, too thin (sliver), oversized, or underwater.
// Each accepted block also gets a `buildable` polygon inset a few units from its road edges, standing in
// for the sidewalk/setback strip between the street and any parcels/buildings placed inside it.
export function extractBlocks(graph: RoadGraph, waterPolygons: Point[][], cityRadius: number): Block[] {
  const minBlockArea = 700
  const maxBlockArea = (cityRadius * 0.85) ** 2
  const minCompactness = 0.02

  const rawFaces = computeFaces(graph.nodes, graph.edges)
  const scored = rawFaces
    .map(pts => ({ pts, area: Math.abs(polygonArea(pts)), perim: polygonPerimeter(pts) }))
    .filter(f => f.pts.length >= 3 && f.area > minBlockArea)
  scored.sort((a, b) => b.area - a.area)
  const candidates = scored.slice(1).filter(f => f.area < maxBlockArea && f.area / (f.perim * f.perim) > minCompactness)

  const blocks: Block[] = []
  candidates.forEach((f, i) => {
    const centroid = polygonCentroid(f.pts)
    if (waterPolygons.some(w => pointInPolygon(centroid.x, centroid.y, w))) return
    const inset = Math.min(6, Math.sqrt(f.area) * 0.06)
    const buildable = insetPolygon(f.pts, inset)
    blocks.push({ id: `block-${i}`, points: f.pts, buildable, area: f.area, centroid, district: 'inner', zone: 'residential' })
  })
  return blocks
}
