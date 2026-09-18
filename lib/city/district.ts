import type { District } from './types'

// Classifies a point by local density (0..1, center-weighted) and distFrac (0 at city center, ~1 at the
// envelope edge). Shared by the road stage (to pick a neighborhood's local-street pattern) and the final
// zoning stage (to color blocks) so the two never disagree about where downtown is.
export function classifyDistrict(dens: number, distFrac: number, rng: () => number): District {
  if (dens > 0.6 && distFrac < 0.5) return 'downtown'
  if (dens < 0.22 && rng() < 0.45) return 'industrial'
  if (dens > 0.3 || distFrac < 0.6) return 'inner'
  return 'outer'
}
