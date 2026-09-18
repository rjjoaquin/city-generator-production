import type { Block, Building, CityPreset, GenerationDiagnostics, RoadGraph } from './types'
import { roadGraphConnectedPercent } from './roadGenerator'

export function computeDiagnostics(
  attempt: number, graph: RoadGraph, rawBlockCount: number, blocks: Block[],
  parcelCount: number, buildings: Building[], usedFallback: boolean,
): GenerationDiagnostics {
  return {
    attempt,
    roadSegments: graph.edges.filter(e => e.width > 0).length,
    roadNodes: graph.nodes.length,
    connectedPercent: roadGraphConnectedPercent(graph) * 100,
    rawBlocks: rawBlockCount,
    acceptedBlocks: blocks.length,
    parks: blocks.filter(b => b.zone === 'park').length,
    parcels: parcelCount,
    buildings: buildings.length,
    usedFallback,
    failureReasons: [],
  }
}

// The gate that decides whether an attempt is good enough to render, or whether generation should retry
// with the next deterministic attempt index (see generateCity). Never silently ship a near-empty city.
export function validateCity(diag: GenerationDiagnostics, preset: CityPreset): string[] {
  const reasons: string[] = []
  if (diag.roadSegments < preset.minRoadSegments) reasons.push(`only ${diag.roadSegments} road segments (need ${preset.minRoadSegments}+)`)
  if (diag.connectedPercent < preset.minConnectedPercent * 100) reasons.push(`only ${diag.connectedPercent.toFixed(1)}% of roads connected (need ${preset.minConnectedPercent * 100}%+)`)
  if (diag.acceptedBlocks < preset.minBlocks) reasons.push(`only ${diag.acceptedBlocks} blocks (need ${preset.minBlocks}+)`)
  if (diag.buildings < preset.minBuildings) reasons.push(`only ${diag.buildings} buildings (need ${preset.minBuildings}+)`)
  return reasons
}
