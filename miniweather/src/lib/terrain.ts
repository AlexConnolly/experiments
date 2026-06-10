import type { Coords } from './types'

/**
 * Real elevation for the diorama: a 13x13 grid from the free Open-Meteo
 * elevation API, bilinearly interpolated. Heights are relative to the centre
 * point so the world stays vertically centred wherever you are.
 */

const N = 13
/** metres covered by the grid — slightly past the 3x3 tile edge */
const SPAN = 1500
const STEP = SPAN / (N - 1)

export interface Terrain {
  /** ground height (m) at local x/z, relative to the centre */
  h(x: number, z: number): number
  min: number
  max: number
}

export const FLAT_TERRAIN: Terrain = { h: () => 0, min: 0, max: 0 }

function buildTerrain(grid: number[][]): Terrain {
  const centre = grid[(N - 1) / 2][(N - 1) / 2]
  let min = Infinity
  let max = -Infinity
  for (const row of grid)
    for (const v of row) {
      min = Math.min(min, v - centre)
      max = Math.max(max, v - centre)
    }
  const h = (x: number, z: number): number => {
    const gx = Math.min(Math.max((x + SPAN / 2) / STEP, 0), N - 1.001)
    const gz = Math.min(Math.max((z + SPAN / 2) / STEP, 0), N - 1.001)
    const ix = Math.floor(gx)
    const iz = Math.floor(gz)
    const fx = gx - ix
    const fz = gz - iz
    const a = grid[iz][ix]
    const b = grid[iz][ix + 1]
    const c = grid[iz + 1][ix]
    const d = grid[iz + 1][ix + 1]
    return a * (1 - fx) * (1 - fz) + b * fx * (1 - fz) + c * (1 - fx) * fz + d * fx * fz - centre
  }
  return { h, min, max }
}

const CACHE_PREFIX = 'mw-terrain-v1:'

export async function fetchTerrain(coords: Coords): Promise<Terrain> {
  const cacheKey = `${CACHE_PREFIX}${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}`
  try {
    const raw = localStorage.getItem(cacheKey)
    if (raw) return buildTerrain(JSON.parse(raw))
  } catch {
    /* refetch */
  }

  const mPerLon = 111_320 * Math.cos((coords.lat * Math.PI) / 180)
  const points: { lat: number; lon: number }[] = []
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const x = -SPAN / 2 + ix * STEP
      const z = -SPAN / 2 + iz * STEP
      points.push({ lat: coords.lat - z / 110_540, lon: coords.lon + x / mPerLon })
    }
  }

  try {
    const elevations: number[] = []
    // the API takes at most 100 points per call
    for (let off = 0; off < points.length; off += 100) {
      const chunk = points.slice(off, off + 100)
      const res = await fetch(
        'https://api.open-meteo.com/v1/elevation' +
          `?latitude=${chunk.map((p) => p.lat.toFixed(5)).join(',')}` +
          `&longitude=${chunk.map((p) => p.lon.toFixed(5)).join(',')}`,
        { signal: AbortSignal.timeout(12_000) },
      )
      if (!res.ok) throw new Error(`elevation ${res.status}`)
      const data = await res.json()
      elevations.push(...(data.elevation as number[]))
    }
    const grid: number[][] = []
    for (let iz = 0; iz < N; iz++)
      grid.push(elevations.slice(iz * N, (iz + 1) * N).map((v) => Math.round(v * 10) / 10))
    try {
      localStorage.setItem(cacheKey, JSON.stringify(grid))
    } catch {
      /* cache is best-effort */
    }
    return buildTerrain(grid)
  } catch {
    return FLAT_TERRAIN
  }
}
