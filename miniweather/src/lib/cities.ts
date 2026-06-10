export type LandmarkKind = 'wheel' | 'eiffel' | 'tower-red' | 'campanile' | 'bigben'

export interface Landmark {
  kind: LandmarkKind
  lat: number
  lon: number
}

export interface City {
  name: string
  lat: number
  lon: number
}

/** Cities centred on their signature landmark, so the grid frames the icon. */
export const CITIES: City[] = [
  { name: 'London', lat: 51.5033, lon: -0.1196 },
  { name: 'Paris', lat: 48.8584, lon: 2.2945 },
  { name: 'New York', lat: 40.7484, lon: -73.9857 },
  { name: 'Tokyo', lat: 35.6586, lon: 139.7454 },
  { name: 'Venice', lat: 45.434, lon: 12.3388 },
  { name: 'Amsterdam', lat: 52.3702, lon: 4.8952 },
  { name: 'Sydney', lat: -33.8568, lon: 151.2153 },
]

/**
 * Hand-built toy models placed at their real coordinates. Whatever location
 * is loaded, any landmark that falls inside the grid gets its model — visit
 * "here" near the South Bank and the Eye shows up too.
 */
export const LANDMARKS: Landmark[] = [
  { kind: 'wheel', lat: 51.5033, lon: -0.1196 }, // London Eye
  { kind: 'bigben', lat: 51.5007, lon: -0.1246 }, // Elizabeth Tower
  { kind: 'eiffel', lat: 48.8584, lon: 2.2945 }, // Eiffel Tower
  { kind: 'tower-red', lat: 35.6586, lon: 139.7454 }, // Tokyo Tower
  { kind: 'campanile', lat: 45.4341, lon: 12.3388 }, // Campanile di San Marco
]
