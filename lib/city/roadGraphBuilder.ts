import type { Point, RoadEdge, RoadType } from './types'
import { distToSegment, segIntersect } from './geometry'

const SNAP = 4

// A mutable planar road graph with a single primitive, addSegment, that keeps the graph topologically
// correct as roads are inserted in any order: new endpoints snap onto existing nodes or splice into the
// middle of an existing edge if they land on it, and any interior crossing with an existing edge splits
// both roads at the crossing point. Every stage of generation (arterials, collectors, local streets,
// connectivity repairs) is just a sequence of addSegment/addPolyline calls on one shared builder.
export function createGraphBuilder() {
  const nodes: Point[] = []
  const edges: RoadEdge[] = []

  const addNode = (x: number, y: number) => { nodes.push({ x, y }); return nodes.length - 1 }

  const nearestNode = (x: number, y: number) => {
    let best = -1, bestD = Infinity
    for (let i = 0; i < nodes.length; i++) {
      const d = Math.hypot(nodes[i].x - x, nodes[i].y - y)
      if (d < bestD) { bestD = d; best = i }
    }
    return { id: best, dist: bestD }
  }

  const splitEdgeAt = (idx: number, px: number, py: number) => {
    const e = edges[idx]; const na = nodes[e.a], nb = nodes[e.b]
    if (Math.hypot(px - na.x, py - na.y) < SNAP) return e.a
    if (Math.hypot(px - nb.x, py - nb.y) < SNAP) return e.b
    const newId = addNode(px, py); const bId = e.b
    edges[idx] = { a: e.a, b: newId, type: e.type, width: e.width }
    edges.push({ a: newId, b: bId, type: e.type, width: e.width })
    return newId
  }

  const edgeExists = (a: number, b: number) => edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))

  // Resolves a world point to a node id: reuse a very close node, splice into whatever edge the point
  // lies on, or fall back to a brand-new node. This is what lets a local street's endpoint land exactly
  // on an arterial and actually join the graph there instead of stopping just short of it.
  const snapOrSplitEndpoint = (x: number, y: number) => {
    const near = nearestNode(x, y)
    if (near.id >= 0 && near.dist < SNAP) return near.id
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]; const a = nodes[e.a], b = nodes[e.b]
      if (distToSegment(x, y, a.x, a.y, b.x, b.y) < SNAP) return splitEdgeAt(i, x, y)
    }
    return addNode(x, y)
  }

  const addSegment = (x1: number, y1: number, x2: number, y2: number, type: RoadType, width: number) => {
    if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) return
    const aId = snapOrSplitEndpoint(x1, y1)
    const bId = snapOrSplitEndpoint(x2, y2)
    if (aId === bId) return
    const ax = nodes[aId].x, ay = nodes[aId].y, bx = nodes[bId].x, by = nodes[bId].y
    const hits: { t: number; edgeIdx: number; x: number; y: number }[] = []
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]
      if (e.a === aId || e.b === aId || e.a === bId || e.b === bId) continue
      const pa = nodes[e.a], pb = nodes[e.b]
      const hit = segIntersect(ax, ay, bx, by, pa.x, pa.y, pb.x, pb.y)
      if (hit) hits.push({ t: hit.t, edgeIdx: i, x: hit.x, y: hit.y })
    }
    hits.sort((p, q) => p.t - q.t)
    let curId = aId
    for (const h of hits) {
      const midId = splitEdgeAt(h.edgeIdx, h.x, h.y)
      if (midId !== curId && !edgeExists(curId, midId)) { edges.push({ a: curId, b: midId, type, width }); curId = midId }
    }
    if (curId !== bId && !edgeExists(curId, bId)) edges.push({ a: curId, b: bId, type, width })
  }

  const addPolyline = (pts: Point[], type: RoadType, width: number) => {
    for (let i = 0; i < pts.length - 1; i++) addSegment(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, type, width)
  }

  return { nodes, edges, addNode, nearestNode, splitEdgeAt, addSegment, addPolyline }
}

export type GraphBuilder = ReturnType<typeof createGraphBuilder>
