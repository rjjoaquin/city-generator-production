import type { Point } from './types'

export const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const rotate = (x: number, y: number, angle: number) => {
  const c = Math.cos(angle), s = Math.sin(angle)
  return { x: x * c - y * s, y: x * s + y * c }
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay; const lenSq = dx * dx + dy * dy
  const t = lenSq ? clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function segIntersect(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
  if (Math.abs(d) < 1e-9) return null
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d
  if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1), t }
  return null
}

export function pointInPolygon(px: number, py: number, poly: Point[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function polygonArea(pts: Point[]) {
  let a = 0
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y }
  return a / 2
}
export function polygonPerimeter(pts: Point[]) {
  let p = 0
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; p += Math.hypot(b.x - a.x, b.y - a.y) }
  return p
}
export function polygonCentroid(pts: Point[]) {
  let x = 0, y = 0; pts.forEach(p => { x += p.x; y += p.y }); return { x: x / pts.length, y: y / pts.length }
}

export function noise2(x: number, y: number, seed: number) {
  return Math.sin(x * 0.008 + seed) * Math.cos(y * 0.011 + seed * 1.7) * 0.5 + Math.sin(x * 0.003 - y * 0.004 + seed * 2.3) * 0.5
}

// Returns the [t0,t1] parameter intervals (along x1,y1 -> x2,y2) that lie inside `poly`.
// Works for convex or non-convex simple polygons via edge-crossing parametrization + midpoint sampling,
// so callers never need bespoke per-polygon clipping logic.
export function clipSegmentToPolygon(x1: number, y1: number, x2: number, y2: number, poly: Point[]): [number, number][] {
  const dx = x2 - x1, dy = y2 - y1
  const ts = new Set<number>([0, 1])
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const hit = segIntersect(x1, y1, x2, y2, a.x, a.y, b.x, b.y)
    if (hit) ts.add(clamp(hit.t, 0, 1))
  }
  const sorted = [...ts].sort((p, q) => p - q)
  const intervals: [number, number][] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i], t1 = sorted[i + 1]
    if (t1 - t0 < 1e-6) continue
    const tm = (t0 + t1) / 2
    if (pointInPolygon(x1 + dx * tm, y1 + dy * tm, poly)) intervals.push([t0, t1])
  }
  return intervals
}

// Subtracts `cut` parameter-intervals from `base` intervals (both sorted-ish, values in [0,1]).
export function subtractIntervals(base: [number, number][], cut: [number, number][]): [number, number][] {
  let result = base
  for (const [c0, c1] of cut) {
    const next: [number, number][] = []
    for (const [b0, b1] of result) {
      if (c1 <= b0 || c0 >= b1) { next.push([b0, b1]); continue }
      if (c0 > b0) next.push([b0, Math.min(c0, b1)])
      if (c1 < b1) next.push([Math.max(c1, b0), b1])
    }
    result = next.filter(([a, b]) => b - a > 1e-6)
  }
  return result
}

// Intersects `base` intervals with `keep` intervals (used to combine "inside envelope" with "inside superblock").
export function intersectIntervals(base: [number, number][], keep: [number, number][]): [number, number][] {
  const result: [number, number][] = []
  for (const [b0, b1] of base) for (const [k0, k1] of keep) {
    const lo = Math.max(b0, k0), hi = Math.min(b1, k1)
    if (hi - lo > 1e-6) result.push([lo, hi])
  }
  return result
}

// Traces faces of a planar graph by always taking the next-clockwise edge at each node.
// Every directed edge belongs to exactly one face; the single largest-area face is the unbounded exterior.
export function computeFaces(nodes: Point[], edges: { a: number; b: number }[]) {
  type Adj = { to: number; edgeIdx: number; angle: number }
  const adj: Adj[][] = nodes.map(() => [])
  edges.forEach((e, i) => {
    const a = nodes[e.a], b = nodes[e.b]; const angAB = Math.atan2(b.y - a.y, b.x - a.x)
    adj[e.a].push({ to: e.b, edgeIdx: i, angle: angAB })
    adj[e.b].push({ to: e.a, edgeIdx: i, angle: angAB + Math.PI })
  })
  adj.forEach(list => list.sort((p, q) => p.angle - q.angle))
  const visited = new Set<string>()
  const faces: Point[][] = []
  for (let start = 0; start < nodes.length; start++) {
    for (const first of adj[start]) {
      const key0 = `${start}>${first.to}>${first.edgeIdx}`
      if (visited.has(key0)) continue
      const facePts: Point[] = []
      let curFrom = start, curTo = first.to, curEdge = first.edgeIdx
      let guard = 0; let ok = true
      while (guard++ < nodes.length + edges.length + 20) {
        visited.add(`${curFrom}>${curTo}>${curEdge}`)
        facePts.push(nodes[curTo])
        const list = adj[curTo]
        const idx = list.findIndex(l => l.edgeIdx === curEdge)
        if (idx < 0 || list.length === 0) { ok = false; break }
        const nxt = list[(idx - 1 + list.length) % list.length]
        curFrom = curTo; curTo = nxt.to; curEdge = nxt.edgeIdx
        if (curFrom === start && curTo === first.to && curEdge === first.edgeIdx) break
      }
      if (ok && facePts.length >= 3) faces.push(facePts)
    }
  }
  return faces
}

// Union-find over node indices; returns a component-id array so isolated fragments can be detected and fixed.
export function connectedComponents(nodeCount: number, edges: { a: number; b: number }[]): number[] {
  const parent = Array.from({ length: nodeCount }, (_, i) => i)
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]))
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  edges.forEach(e => union(e.a, e.b))
  return parent.map((_, i) => find(i))
}

// Inward offset of a simple polygon by `amount`, used to carve sidewalks/setbacks between roads and lots.
// Moves each edge inward along its normal and re-intersects consecutive offset edges; falls back to a
// centroid pull for any vertex whose neighboring offset edges don't cross cleanly (thin/near-degenerate corners).
export function insetPolygon(pts: Point[], amount: number): Point[] {
  const n = pts.length
  if (n < 3) return pts
  const c = polygonCentroid(pts)
  const signedArea = polygonArea(pts)
  const sign = signedArea < 0 ? -1 : 1
  const offsetLines = pts.map((a, i) => {
    const b = pts[(i + 1) % n]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const nx = (dy / len) * sign, ny = (-dx / len) * sign
    return { ax: a.x + nx * amount, ay: a.y + ny * amount, bx: b.x + nx * amount, by: b.y + ny * amount }
  })
  const result: Point[] = []
  for (let i = 0; i < n; i++) {
    const prev = offsetLines[(i - 1 + n) % n], cur = offsetLines[i]
    const hit = lineLineIntersect(prev.ax, prev.ay, prev.bx, prev.by, cur.ax, cur.ay, cur.bx, cur.by)
    if (hit) result.push(hit)
    else result.push({ x: lerp(pts[i].x, c.x, 0.15), y: lerp(pts[i].y, c.y, 0.15) })
  }
  return result
}

function lineLineIntersect(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): Point | null {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
  if (Math.abs(d) < 1e-9) return null
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) }
}
