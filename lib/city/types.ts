export type CitySize = 'small' | 'medium' | 'large'
export type Zone = 'residential' | 'commercial' | 'industrial'
export type District = 'downtown' | 'inner' | 'outer' | 'industrial'
export type RoadType = 'arterial' | 'collector' | 'local'
export type LocalPattern = 'grid' | 'organic' | 'radial' | 'suburban'
export type Point = { x: number; y: number }

export type Road = { id: string; type: RoadType; points: Point[]; width: number }
export type RoadEdge = { a: number; b: number; type: RoadType; width: number }
export type RoadGraph = { nodes: Point[]; edges: RoadEdge[] }

export type Block = { id: string; points: Point[]; buildable: Point[]; area: number; centroid: Point; district: District; zone: Zone | 'park' }
export type Parcel = { id: string; blockId: string; x: number; y: number; width: number; height: number; angle: number }
export type Building = { id: string; x: number; y: number; width: number; height: number; zone: Zone; angle: number; floors: number; seed: number }

export type GenerationDiagnostics = {
  attempt: number
  roadSegments: number
  roadNodes: number
  connectedPercent: number
  rawBlocks: number
  acceptedBlocks: number
  parks: number
  parcels: number
  buildings: number
  usedFallback: boolean
  failureReasons: string[]
}

export type City = {
  seed: string; size: CitySize; mapSize: number; center: Point; envelope: Point[]
  roads: Road[]; blocks: Block[]; buildings: Building[]; parks: Block[]; water: Point[][]
  stats: { roads: number; blocks: number; buildings: number; parkArea: number }
  diagnostics: GenerationDiagnostics
}

// Validation targets and physical scale for a city size. Counts are ranges to steer generation toward
// and to validate against — not exact quotas that generation blindly fills.
export type CityPreset = {
  mapSize: number
  cityRadius: number
  arterialCount: number
  collectorTarget: [number, number]
  localTarget: [number, number]
  minRoadSegments: number
  minConnectedPercent: number
  minBlocks: number
  minBuildings: number
}

export type CityConfig = {
  seed: string; size: CitySize; roadDensity: number; roadRandomness: number; gridBias: number
  downtownDensity: number; suburbanDensity: number; residentialRatio: number; commercialRatio: number; industrialRatio: number
  parkRatio: number; greenSpace: number; buildingSizeVariation: number; riverEnabled: boolean; coastlineEnabled: boolean
}

export const presets: Record<CitySize, CityPreset> = {
  small: {
    mapSize: 900, cityRadius: 340, arterialCount: 3, collectorTarget: [8, 15], localTarget: [30, 60],
    minRoadSegments: 25, minConnectedPercent: 0.95, minBlocks: 18, minBuildings: 60,
  },
  medium: {
    mapSize: 1600, cityRadius: 650, arterialCount: 5, collectorTarget: [15, 30], localTarget: [60, 140],
    minRoadSegments: 50, minConnectedPercent: 0.95, minBlocks: 40, minBuildings: 150,
  },
  large: {
    mapSize: 2600, cityRadius: 1050, arterialCount: 7, collectorTarget: [30, 60], localTarget: [150, 350],
    minRoadSegments: 90, minConnectedPercent: 0.95, minBlocks: 100, minBuildings: 500,
  },
}

export const defaultConfig: CityConfig = {
  seed: 'NOVA-18472', size: 'medium', roadDensity: .5, roadRandomness: .35, gridBias: .5,
  downtownDensity: .8, suburbanDensity: .35, residentialRatio: .55, commercialRatio: .2, industrialRatio: .1,
  parkRatio: .15, greenSpace: .15, buildingSizeVariation: .4, riverEnabled: false, coastlineEnabled: false,
}
