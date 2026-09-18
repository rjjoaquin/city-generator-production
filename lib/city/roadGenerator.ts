import type { CityConfig, CityPreset, District, LocalPattern, Point, RoadGraph, RoadType } from './types'
import {
  clamp, clipSegmentToPolygon, computeFaces, connectedComponents, distToSegment,
  insetPolygon, lerp, pointInPolygon, polygonArea, polygonCentroid, rotate,
} from './geometry'
import { classifyDistrict } from './district'
import { createGraphBuilder, type GraphBuilder } from './roadGraphBuilder'
import type { Terrain } from './envelope'

const WIDTH: Record<RoadType, number> = { arterial: 18, collector: 10, local: 6 }
const MIN_LENGTH: Record<RoadType, number> = { arterial: 150, collector: 70, local: 30 }

// Clips a candidate segment to "inside the envelope and outside every water polygon", returning the
// single longest resulting stretch. This is the "shorten/clip instead of reject" validation the whole
// pipeline leans on: a candidate that pokes outside the city is trimmed back, never thrown away outright.
function clipToDevelopable(p1: Point, p2: Point, terrain: Terrain): [Point, Point] | null {
  let intervals = clipSegmentToPolygon(p1.x, p1.y, p2.x, p2.y, terrain.envelope)
  for (const water of terrain.waterPolygons) {
    const cut = clipSegmentToPolygon(p1.x, p1.y, p2.x, p2.y, water)
    if (cut.length) intervals = intervals.flatMap(([a, b]): [number, number][] => {
      const pieces: [number, number][] = []
      let cursor = a
      for (const [c0, c1] of cut) {
        if (c1 <= cursor || c0 >= b) continue
        if (c0 > cursor) pieces.push([cursor, Math.min(c0, b)])
        cursor = Math.max(cursor, c1)
      }
      if (cursor < b) pieces.push([cursor, b])
      return pieces
    })
  }
  if (!intervals.length) return null
  const [t0, t1] = intervals.reduce((best, cur) => (cur[1] - cur[0] > best[1] - best[0] ? cur : best))
  return [{ x: lerp(p1.x, p2.x, t0), y: lerp(p1.y, p2.y, t0) }, { x: lerp(p1.x, p2.x, t1), y: lerp(p1.y, p2.y, t1) }]
}

function polylineLength(pts: Point[]) {
  let len = 0
  for (let i = 0; i < pts.length - 1; i++) len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
  return len
}

// ---------------------------------------------------------------------------------------------
// Stage 1: guaranteed arterial skeleton — a handful of long chords through the developed envelope,
// spread evenly in angle (mod PI, since a "road direction" and its reverse are the same line) and offset
// laterally so they don't all cross at one exact point. Every arterial spans edge-to-edge of the city by
// construction, and any two with sufficiently different angles necessarily cross near the middle.
// ---------------------------------------------------------------------------------------------
function buildArterials(rng: () => number, config: CityConfig, preset: CityPreset, terrain: Terrain, center: Point, g: GraphBuilder) {
  const baseAngle = rng() * Math.PI
  for (let i = 0; i < preset.arterialCount; i++) {
    const angle = baseAngle + (i / preset.arterialCount) * Math.PI + (rng() - 0.5) * (Math.PI / preset.arterialCount) * 0.5
    const perp = angle + Math.PI / 2
    const lateral = (rng() - 0.5) * terrain.radiusAt(perp) * 0.45
    const origin = { x: center.x + Math.cos(perp) * lateral, y: center.y + Math.sin(perp) * lateral }
    const dir = { x: Math.cos(angle), y: Math.sin(angle) }
    const far = preset.cityRadius * 3
    const p1 = { x: origin.x - dir.x * far, y: origin.y - dir.y * far }
    const p2 = { x: origin.x + dir.x * far, y: origin.y + dir.y * far }
    const clipped = clipToDevelopable(p1, p2, terrain)
    if (!clipped) continue
    const [ep1, ep2] = clipped
    const chordLen = Math.hypot(ep2.x - ep1.x, ep2.y - ep1.y)
    if (chordLen < MIN_LENGTH.arterial) continue

    const segCount = clamp(Math.round(chordLen / 220), 2, 10)
    const pts: Point[] = [ep1]
    for (let j = 1; j < segCount; j++) {
      const t = j / segCount
      const base = { x: lerp(ep1.x, ep2.x, t), y: lerp(ep1.y, ep2.y, t) }
      const jitterAmt = chordLen * 0.045 * (0.4 + config.roadRandomness) * (1 - config.gridBias * 0.6)
      const nx = -dir.y, ny = dir.x
      let px = base.x + nx * (rng() - 0.5) * jitterAmt * 2
      let py = base.y + ny * (rng() - 0.5) * jitterAmt * 2
      if (!terrain.validPoint(px, py)) { px = base.x; py = base.y }
      pts.push({ x: px, y: py })
    }
    pts.push(ep2)
    g.addPolyline(pts, 'arterial', WIDTH.arterial)
  }
}

// ---------------------------------------------------------------------------------------------
// Stage 2: collector network — systematically seeded at intervals along arterials (then along the
// collectors that seeding produces), grown a few bent segments outward, clipped progressively against
// the envelope/water, and snapped onto whatever road it reaches so most collectors connect at both ends.
// ---------------------------------------------------------------------------------------------
function growCollectorChain(rng: () => number, terrain: Terrain, g: GraphBuilder, start: Point, startAngle: number, maxLen: number): Point[] | null {
  const pts: Point[] = [start]
  let x = start.x, y = start.y, angle = startAngle, remaining = maxLen
  const stepLen = 90
  for (let step = 0; step < 6 && remaining > 0; step++) {
    angle += (rng() - 0.5) * 0.5
    const len = Math.min(stepLen * (0.7 + rng() * 0.6), remaining)
    let ex = x + Math.cos(angle) * len, ey = y + Math.sin(angle) * len
    const clipped = clipToDevelopable({ x, y }, { x: ex, y: ey }, terrain)
    if (!clipped) break
    ;[, { x: ex, y: ey }] = clipped
    // stop at the first existing road this step crosses, so the chain naturally terminates at a junction
    let hitT = 1, hit: Point | null = null
    for (const e of g.edges) {
      const a = g.nodes[e.a], b = g.nodes[e.b]
      if (Math.hypot(a.x - x, a.y - y) < 1 || Math.hypot(b.x - x, b.y - y) < 1) continue
      const t = segHitT(x, y, ex, ey, a.x, a.y, b.x, b.y)
      if (t !== null && t < hitT) { hitT = t; hit = { x: x + (ex - x) * t, y: y + (ey - y) * t } }
    }
    if (hit) { pts.push(hit); return pts }
    if (Math.hypot(ex - x, ey - y) < 3) break
    pts.push({ x: ex, y: ey })
    remaining -= Math.hypot(ex - x, ey - y)
    x = ex; y = ey
  }
  // didn't reach a junction on its own — reach out to the nearest existing node within a generous radius
  if (rng() < 0.85) {
    const near = g.nearestNode(x, y)
    if (near.id >= 0 && near.dist < 220 && near.dist > 3) {
      const target = g.nodes[near.id]
      const clipped = clipToDevelopable({ x, y }, target, terrain)
      if (clipped) pts.push(clipped[1])
    }
  }
  return pts
}

function segHitT(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): number | null {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
  if (Math.abs(d) < 1e-9) return null
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d
  if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) return t
  return null
}

function buildCollectors(rng: () => number, config: CityConfig, preset: CityPreset, terrain: Terrain, g: GraphBuilder) {
  const [minC, maxC] = preset.collectorTarget
  const target = Math.round(lerp(minC, maxC, clamp(0.3 + config.roadDensity * 0.7)))
  const spacing = clamp(lerp(180, 100, preset.cityRadius / 1050), 90, 190)
  let added = 0

  const seedFrom = (edgeSnapshot: { a: number; b: number; type: RoadType }[]) => {
    for (const e of edgeSnapshot) {
      if (added >= target) return
      const a = g.nodes[e.a], b = g.nodes[e.b]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 25) continue
      const edgeAngle = Math.atan2(b.y - a.y, b.x - a.x)
      const steps = Math.max(1, Math.round(len / spacing))
      for (let s = 0; s < steps && added < target; s++) {
        if (rng() > 0.55 + config.roadDensity * 0.35) continue
        const t = (s + 0.5) / steps
        const px = lerp(a.x, b.x, t), py = lerp(a.y, b.y, t)
        if (!terrain.validPoint(px, py)) continue
        const side = rng() < 0.5 ? 1 : -1
        const angle = edgeAngle + side * (Math.PI / 2) + (rng() - 0.5) * (1 - config.gridBias) * 0.7
        const maxLen = 220 + rng() * 260
        const chain = growCollectorChain(rng, terrain, g, { x: px, y: py }, angle, maxLen)
        if (chain && polylineLength(chain) >= MIN_LENGTH.collector) { g.addPolyline(chain, 'collector', WIDTH.collector); added++ }
      }
    }
  }

  seedFrom(g.edges.filter(e => e.type === 'arterial').map(e => ({ ...e })))
  if (added < target) seedFrom(g.edges.filter(e => e.type === 'collector').map(e => ({ ...e })))
  let guard = 0
  while (added < target && guard++ < target * 3) {
    const collectorEdges = g.edges.filter(e => e.type === 'collector')
    if (!collectorEdges.length) break
    const e = collectorEdges[Math.floor(rng() * collectorEdges.length)]
    const a = g.nodes[e.a], b = g.nodes[e.b]
    const t = rng()
    const px = lerp(a.x, b.x, t), py = lerp(a.y, b.y, t)
    if (!terrain.validPoint(px, py)) continue
    const angle = Math.atan2(b.y - a.y, b.x - a.x) + (rng() < 0.5 ? 1 : -1) * Math.PI / 2
    const chain = growCollectorChain(rng, terrain, g, { x: px, y: py }, angle, 200 + rng() * 220)
    if (chain && polylineLength(chain) >= MIN_LENGTH.collector) { g.addPolyline(chain, 'collector', WIDTH.collector); added++ }
  }
}

// Seals the developed envelope into the graph as a closed ring so the outer fringe — between the
// outermost roads and the city limit — becomes a genuine enclosed region instead of silently merging into
// the graph's single unbounded "exterior" face (where it would never become a block at all). Ring edges
// carry a negative sentinel width so they're filtered out of every rendered/validated road count; they
// exist purely to give computeFaces something to close the outer blocks against, the way a coastline or
// city limit line would in a real map. Existing arterial/collector tips that were clipped exactly onto the
// envelope earlier get spliced into the ring here instead of duplicated.
function addEnvelopeRing(g: GraphBuilder, envelope: Point[]) {
  const n = envelope.length
  for (let i = 0; i < n; i++) {
    const a = envelope[i], b = envelope[(i + 1) % n]
    const onSeg: { t: number; id: number }[] = []
    for (let ni = 0; ni < g.nodes.length; ni++) {
      const p = g.nodes[ni]
      if (distToSegment(p.x, p.y, a.x, a.y, b.x, b.y) < 2) {
        const dx = b.x - a.x, dy = b.y - a.y
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)
        if (t > 0.002 && t < 0.998) onSeg.push({ t, id: ni })
      }
    }
    onSeg.sort((p, q) => p.t - q.t)
    let cx = a.x, cy = a.y
    for (const pt of onSeg) { const p = g.nodes[pt.id]; g.addSegment(cx, cy, p.x, p.y, 'local', -1); cx = p.x; cy = p.y }
    g.addSegment(cx, cy, b.x, b.y, 'local', -1)
  }
}

// Collector growth is organic and can leave a few oversized, unevenly-shaped superblocks even when the
// overall count/spacing targets are met. Rather than lean on local streets to fix that unevenness inside
// a single huge cell, this bisects any superblock over `threshold` with one or two extra collector-grade
// lines through its centroid — repeated until every superblock is reasonably sized before local streets run.
function capSuperblockSize(g: GraphBuilder, threshold: number) {
  let guard = 0
  let prevArea = Infinity
  while (guard++ < 24) {
    const faces = computeFaces(g.nodes, g.edges)
    const scored = faces.map(pts => ({ pts, area: Math.abs(polygonArea(pts)) })).filter(f => f.pts.length >= 3)
    scored.sort((a, b) => b.area - a.area)
    const big = scored.slice(1).find(f => f.area > threshold)
    if (!big) return
    // A shape that isn't actually shrinking under repeated bisection (e.g. a thin C/ring-shaped residual
    // where a straight centroid cut barely clips it) would otherwise loop to the guard cap, carving the
    // same region into hundreds of slivers. Bail out and leave it slightly oversized instead.
    if (big.area >= prevArea * 0.95) return
    prevArea = big.area
    // World-axis bisectors through the centroid, clipped with the same multi-interval logic used
    // everywhere else — robust even for concave/irregular superblocks where a single straight cut
    // wouldn't reach edge-to-edge.
    const c = polygonCentroid(big.pts)
    const minX = Math.min(...big.pts.map(p => p.x)) - 10, maxX = Math.max(...big.pts.map(p => p.x)) + 10
    const minY = Math.min(...big.pts.map(p => p.y)) - 10, maxY = Math.max(...big.pts.map(p => p.y)) + 10
    let addedAny = false
    const cuts: [Point, Point][] = [
      [{ x: c.x, y: minY }, { x: c.x, y: maxY }],
      [{ x: minX, y: c.y }, { x: maxX, y: c.y }],
    ]
    for (const [p1, p2] of cuts) {
      for (const [t0, t1] of clipSegmentToPolygon(p1.x, p1.y, p2.x, p2.y, big.pts)) {
        const len = (t1 - t0) * Math.hypot(p2.x - p1.x, p2.y - p1.y)
        if (len < MIN_LENGTH.collector) continue
        g.addSegment(lerp(p1.x, p2.x, t0), lerp(p1.y, p2.y, t0), lerp(p1.x, p2.x, t1), lerp(p1.y, p2.y, t1), 'collector', WIDTH.collector)
        addedAny = true
      }
    }
    if (!addedAny) return // couldn't cut this one down; stop rather than loop forever
  }
}

// ---------------------------------------------------------------------------------------------
// Stage 3: local streets — the arterial+collector graph already encloses "superblocks"; each one gets a
// per-neighborhood pattern (grid / organic / radial / suburban) chosen from its density and distance from
// the center, so downtown reads as a tight grid while the outskirts read as looser and more irregular.
// ---------------------------------------------------------------------------------------------
function longestEdgeAngle(poly: Point[]) {
  let bestLen = -1, theta = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    if (L > bestLen) { bestLen = L; theta = Math.atan2(b.y - a.y, b.x - a.x) }
  }
  return theta
}

function gridLocalStreets(poly: Point[], g: GraphBuilder, rng: () => number, spacing: number) {
  const c = polygonCentroid(poly)
  const theta = longestEdgeAngle(poly)
  const toWorld = (p: Point) => { const r = rotate(p.x, p.y, theta); return { x: c.x + r.x, y: c.y + r.y } }
  const local = poly.map(p => rotate(p.x - c.x, p.y - c.y, -theta))
  const minX = Math.min(...local.map(p => p.x)) - 10, maxX = Math.max(...local.map(p => p.x)) + 10
  const minY = Math.min(...local.map(p => p.y)) - 10, maxY = Math.max(...local.map(p => p.y)) + 10

  for (let lx = minX + spacing * (0.4 + rng() * 0.2); lx < maxX; lx += spacing * (0.9 + rng() * 0.2)) {
    if (rng() < 0.06) continue
    const p1 = toWorld({ x: lx, y: minY }), p2 = toWorld({ x: lx, y: maxY })
    for (const [t0, t1] of clipSegmentToPolygon(p1.x, p1.y, p2.x, p2.y, poly)) {
      if ((t1 - t0) * Math.hypot(p2.x - p1.x, p2.y - p1.y) < MIN_LENGTH.local) continue
      g.addSegment(lerp(p1.x, p2.x, t0), lerp(p1.y, p2.y, t0), lerp(p1.x, p2.x, t1), lerp(p1.y, p2.y, t1), 'local', WIDTH.local)
    }
  }
  for (let ly = minY + spacing * (0.4 + rng() * 0.2); ly < maxY; ly += spacing * (0.9 + rng() * 0.2)) {
    if (rng() < 0.06) continue
    const p1 = toWorld({ x: minX, y: ly }), p2 = toWorld({ x: maxX, y: ly })
    for (const [t0, t1] of clipSegmentToPolygon(p1.x, p1.y, p2.x, p2.y, poly)) {
      if ((t1 - t0) * Math.hypot(p2.x - p1.x, p2.y - p1.y) < MIN_LENGTH.local) continue
      g.addSegment(lerp(p1.x, p2.x, t0), lerp(p1.y, p2.y, t0), lerp(p1.x, p2.x, t1), lerp(p1.y, p2.y, t1), 'local', WIDTH.local)
    }
  }
}

function organicLocalStreets(poly: Point[], g: GraphBuilder, rng: () => number, spacing: number) {
  const c = polygonCentroid(poly)
  const theta = longestEdgeAngle(poly) + (rng() - 0.5) * 0.4
  const toWorld = (p: Point) => { const r = rotate(p.x, p.y, theta); return { x: c.x + r.x, y: c.y + r.y } }
  const local = poly.map(p => rotate(p.x - c.x, p.y - c.y, -theta))
  const minX = Math.min(...local.map(p => p.x)) - 10, maxX = Math.max(...local.map(p => p.x)) + 10
  const minY = Math.min(...local.map(p => p.y)) - 10, maxY = Math.max(...local.map(p => p.y)) + 10
  const freq = 0.9 + rng() * 0.6, phase = rng() * Math.PI * 2, amp = spacing * 0.35

  for (let lx = minX + spacing * 0.5; lx < maxX; lx += spacing * (1 + rng() * 0.4)) {
    if (rng() < 0.15) continue
    const pts: Point[] = []
    for (let ly = minY; ly <= maxY; ly += spacing * 0.4) pts.push(toWorld({ x: lx + Math.sin(ly * 0.01 * freq + phase) * amp, y: ly }))
    tracePolylineIntoFace(pts, poly, g, rng)
  }
  for (let ly = minY + spacing * 0.5; ly < maxY; ly += spacing * (1 + rng() * 0.4)) {
    if (rng() < 0.15) continue
    const pts: Point[] = []
    for (let lx = minX; lx <= maxX; lx += spacing * 0.4) pts.push(toWorld({ x: lx, y: ly + Math.sin(lx * 0.01 * freq + phase + 1.7) * amp }))
    tracePolylineIntoFace(pts, poly, g, rng)
  }
}

// Walks a wavy candidate polyline, only committing the sub-runs that stay inside the face polygon.
function tracePolylineIntoFace(pts: Point[], poly: Point[], g: GraphBuilder, rng: () => number) {
  let run: Point[] = []
  const flush = () => { if (run.length >= 2 && polylineLength(run) >= MIN_LENGTH.local) g.addPolyline(run, 'local', WIDTH.local); run = [] }
  for (let i = 0; i < pts.length; i++) {
    if (pointInPolygon(pts[i].x, pts[i].y, poly)) run.push(pts[i])
    else flush()
  }
  flush()
}

function radialLocalStreets(poly: Point[], g: GraphBuilder, rng: () => number) {
  const c = polygonCentroid(poly)
  if (!pointInPolygon(c.x, c.y, poly)) return
  const maxR = Math.max(...poly.map(p => Math.hypot(p.x - c.x, p.y - c.y)))
  const spokes = 4 + Math.floor(rng() * 3)
  const baseA = rng() * Math.PI * 2
  for (let i = 0; i < spokes; i++) {
    const a = baseA + (i / spokes) * Math.PI * 2
    const tip = { x: c.x + Math.cos(a) * maxR * 1.3, y: c.y + Math.sin(a) * maxR * 1.3 }
    for (const [t0, t1] of clipSegmentToPolygon(c.x, c.y, tip.x, tip.y, poly)) {
      if ((t1 - t0) * maxR * 1.3 < MIN_LENGTH.local) continue
      g.addSegment(lerp(c.x, tip.x, t0), lerp(c.y, tip.y, t0), lerp(c.x, tip.x, t1), lerp(c.y, tip.y, t1), 'local', WIDTH.local)
    }
  }
  for (const frac of [0.45, 0.8]) {
    const pts: Point[] = []
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; pts.push({ x: c.x + Math.cos(a) * maxR * frac, y: c.y + Math.sin(a) * maxR * frac }) }
    tracePolylineIntoFace(pts, poly, g, rng)
  }
}

function suburbanLocalStreets(poly: Point[], g: GraphBuilder, rng: () => number) {
  const area = Math.abs(polygonArea(poly))
  const inset = clamp(Math.sqrt(area) * 0.16, 18, 70)
  const loop = insetPolygon(poly, inset)
  tracePolylineIntoFace([...loop, loop[0]], poly, g, rng)
  const stubCount = 2 + Math.floor(rng() * 3)
  for (let i = 0; i < stubCount; i++) {
    const idx = Math.floor(rng() * loop.length)
    const p = loop[idx]
    const c = polygonCentroid(poly)
    const outward = { x: p.x + (p.x - c.x) * 0.35 + (rng() - 0.5) * 20, y: p.y + (p.y - c.y) * 0.35 + (rng() - 0.5) * 20 }
    for (const [t0, t1] of clipSegmentToPolygon(p.x, p.y, outward.x, outward.y, poly)) {
      const dist = Math.hypot(outward.x - p.x, outward.y - p.y)
      if ((t1 - t0) * dist < MIN_LENGTH.local * 0.6) continue
      g.addSegment(lerp(p.x, outward.x, t0), lerp(p.y, outward.y, t0), lerp(p.x, outward.x, t1), lerp(p.y, outward.y, t1), 'local', WIDTH.local)
    }
  }
}

function pickPattern(district: District, config: CityConfig, rng: () => number): LocalPattern {
  if (district === 'industrial') return 'grid'
  if (district === 'downtown') return rng() < 0.85 + config.gridBias * 0.1 ? 'grid' : 'organic'
  if (district === 'inner') return rng() < 0.4 + config.gridBias * 0.4 ? 'grid' : (rng() < 0.5 ? 'organic' : 'radial')
  const roll = rng()
  if (roll < 0.1) return 'radial'
  return rng() < 0.45 + (1 - config.gridBias) * 0.2 ? 'organic' : 'suburban'
}

function buildLocalStreets(rng: () => number, config: CityConfig, terrain: Terrain, center: Point, g: GraphBuilder) {
  const coarseEdges = g.edges.map(e => ({ ...e }))
  const coarseNodes = g.nodes.map(p => ({ ...p }))
  const faces = computeFaces(coarseNodes, coarseEdges)
  const scored = faces.map(pts => ({ pts, area: Math.abs(polygonArea(pts)) })).filter(f => f.pts.length >= 3)
  scored.sort((a, b) => b.area - a.area)
  const superblocks = scored.slice(1) // drop the unbounded exterior face

  for (const face of superblocks) {
    const centroid = polygonCentroid(face.pts)
    if (!terrain.validPoint(centroid.x, centroid.y)) continue
    if (face.area < 4000) continue
    const dens = terrain.densityAt(centroid.x, centroid.y)
    const distFrac = clamp(Math.hypot(centroid.x - center.x, centroid.y - center.y) / Math.max(1, terrain.radiusAt(Math.atan2(centroid.y - center.y, centroid.x - center.x))))
    const district = classifyDistrict(dens, distFrac, rng)
    const pattern = pickPattern(district, config, rng)
    // Block-scale spacing: local streets carve a superblock into several human-scale blocks, not a fine
    // lot-sized mesh — parcelGenerator is what subdivides each resulting block into individual lots.
    const spacing = district === 'downtown' ? 70 + rng() * 35 : district === 'inner' ? 100 + rng() * 45 : district === 'industrial' ? 240 + rng() * 100 : 150 + rng() * 70

    if (pattern === 'grid') gridLocalStreets(face.pts, g, rng, spacing)
    else if (pattern === 'organic') organicLocalStreets(face.pts, g, rng, spacing)
    else if (pattern === 'radial') radialLocalStreets(face.pts, g, rng)
    else suburbanLocalStreets(face.pts, g, rng)
  }
}

// ---------------------------------------------------------------------------------------------
// Stage 4: connectivity enforcement — the graph is treated as ground truth after all three road stages
// run; any component that isn't the dominant one gets welded to the nearest node on the main network, or
// deleted if nothing reasonable is in reach. This is what makes ">=95% of roads in one component" a
// guarantee rather than a hope.
// ---------------------------------------------------------------------------------------------
// Only positive-width edges count as "real roads" here — the envelope ring (sentinel width -1) never
// counts toward or masks connectivity, so welding/deletion decisions reflect the actual street network.
function enforceConnectivity(g: GraphBuilder, preset: CityPreset) {
  const connectRadius = preset.cityRadius * 0.6
  let guard = 0
  while (guard++ < 200) {
    const real = g.edges.filter(e => e.width > 0)
    if (!real.length) return
    const comps = connectedComponents(g.nodes.length, real)
    const touched = new Set<number>()
    real.forEach(e => { touched.add(e.a); touched.add(e.b) })
    const byComp = new Map<number, number[]>()
    comps.forEach((c, i) => { if (!touched.has(i)) return; if (!byComp.has(c)) byComp.set(c, []); byComp.get(c)!.push(i) })
    const sizes = [...byComp.entries()].sort((a, b) => b[1].length - a[1].length)
    if (sizes.length <= 1) return
    const mainNodes = sizes[0][1]
    const [, nodeIds] = sizes[1]
    let best = { d: Infinity, a: -1, b: -1 }
    for (const a of nodeIds) for (const b of mainNodes) {
      const d = Math.hypot(g.nodes[a].x - g.nodes[b].x, g.nodes[a].y - g.nodes[b].y)
      if (d < best.d) best = { d, a, b }
    }
    if (best.a >= 0 && best.d < connectRadius) {
      g.addSegment(g.nodes[best.a].x, g.nodes[best.a].y, g.nodes[best.b].x, g.nodes[best.b].y, 'local', WIDTH.local)
    } else {
      const drop = new Set(nodeIds)
      const kept = g.edges.filter(e => !(e.width > 0 && drop.has(e.a) && drop.has(e.b)))
      g.edges.length = 0
      kept.forEach(e => g.edges.push(e))
    }
  }
}

export function generateRoadGraph(rng: () => number, config: CityConfig, preset: CityPreset, terrain: Terrain, center: Point): RoadGraph {
  const g = createGraphBuilder()
  buildArterials(rng, config, preset, terrain, center, g)
  buildCollectors(rng, config, preset, terrain, g)
  enforceConnectivity(g, preset)
  addEnvelopeRing(g, terrain.envelope)
  capSuperblockSize(g, (preset.cityRadius * 0.34) ** 2)
  buildLocalStreets(rng, config, terrain, center, g)
  enforceConnectivity(g, preset)
  return { nodes: g.nodes, edges: g.edges }
}

// Percent of *real* road segments (envelope-ring sentinel edges excluded) in the largest connected
// component — this is the metric validation checks against the ">=95% connected" requirement.
export function roadGraphConnectedPercent(graph: RoadGraph): number {
  const real = graph.edges.filter(e => e.width > 0)
  if (!real.length) return 0
  const comps = connectedComponents(graph.nodes.length, real)
  const counts = new Map<number, number>()
  real.forEach(e => { const c = comps[e.a]; counts.set(c, (counts.get(c) ?? 0) + 1) })
  const maxCount = Math.max(...counts.values())
  return maxCount / real.length
}

// Deterministic guaranteed-valid fallback: a plain rectilinear grid of arterials/collectors/locals across
// the developed envelope. No randomness in its topology, so it can never fail — used only if three full
// procedural attempts still don't clear validation thresholds.
export function generateFallbackSkeleton(preset: CityPreset, terrain: Terrain, center: Point): RoadGraph {
  const g = createGraphBuilder()
  const r = preset.cityRadius
  const arterialSpacing = r * 0.9
  for (let i = -1; i <= 1; i++) {
    const off = i * arterialSpacing
    const v = clipToDevelopable({ x: center.x + off, y: center.y - r * 1.6 }, { x: center.x + off, y: center.y + r * 1.6 }, terrain)
    if (v) g.addPolyline([v[0], v[1]], 'arterial', WIDTH.arterial)
    const h = clipToDevelopable({ x: center.x - r * 1.6, y: center.y + off }, { x: center.x + r * 1.6, y: center.y + off }, terrain)
    if (h) g.addPolyline([h[0], h[1]], 'arterial', WIDTH.arterial)
  }
  const collectorSpacing = arterialSpacing / 3
  for (let i = -4; i <= 4; i++) {
    if (i % 3 === 0) continue
    const off = i * collectorSpacing
    const v = clipToDevelopable({ x: center.x + off, y: center.y - r * 1.5 }, { x: center.x + off, y: center.y + r * 1.5 }, terrain)
    if (v && Math.hypot(v[1].x - v[0].x, v[1].y - v[0].y) >= MIN_LENGTH.collector) g.addPolyline([v[0], v[1]], 'collector', WIDTH.collector)
    const h = clipToDevelopable({ x: center.x - r * 1.5, y: center.y + off }, { x: center.x + r * 1.5, y: center.y + off }, terrain)
    if (h && Math.hypot(h[1].x - h[0].x, h[1].y - h[0].y) >= MIN_LENGTH.collector) g.addPolyline([h[0], h[1]], 'collector', WIDTH.collector)
  }
  const localSpacing = collectorSpacing / 3
  for (let i = -12; i <= 12; i++) {
    if (i % 3 === 0) continue
    const off = i * localSpacing
    const v = clipToDevelopable({ x: center.x + off, y: center.y - r * 1.4 }, { x: center.x + off, y: center.y + r * 1.4 }, terrain)
    if (v && Math.hypot(v[1].x - v[0].x, v[1].y - v[0].y) >= MIN_LENGTH.local) g.addPolyline([v[0], v[1]], 'local', WIDTH.local)
    const h = clipToDevelopable({ x: center.x - r * 1.4, y: center.y + off }, { x: center.x + r * 1.4, y: center.y + off }, terrain)
    if (h && Math.hypot(h[1].x - h[0].x, h[1].y - h[0].y) >= MIN_LENGTH.local) g.addPolyline([h[0], h[1]], 'local', WIDTH.local)
  }
  enforceConnectivity(g, preset)
  return { nodes: g.nodes, edges: g.edges }
}
