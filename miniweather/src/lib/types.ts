export type Condition =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunder'

export interface Weather {
  temperature: number
  feelsLike: number
  condition: Condition
  isDay: boolean
  windSpeed: number
  cloudCover: number
  description: string
}

export interface Coords {
  lat: number
  lon: number
  approximate: boolean
}

/** Local-space (metres, x east / z south of centre) geometry of the place. */
export interface WorldData {
  buildings: { footprint: [number, number][]; height: number }[]
  roads: {
    path: [number, number][]
    width: number
    kind: 'road' | 'path'
    bridge?: boolean
  }[]
  water: [number, number][][]
  /** navigable waterway centrelines — boats drift along these */
  waterways: [number, number][][]
  /** surface railway centrelines (tunnels excluded) — trains run along these */
  rails: { path: [number, number][]; bridge?: boolean }[]
  /** airport surfaces */
  aeroways: { path: [number, number][]; width: number; kind: 'runway' | 'taxiway' }[]
  aprons: [number, number][][]
  green: [number, number][][]
  trees: [number, number][]
}
