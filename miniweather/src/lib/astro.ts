/** Minimal positional astronomy — good to a fraction of a degree, plenty for a diorama sky. */

const DEG = Math.PI / 180

/** Days since J2000.0 (2000-01-01 12:00 UT). */
function j2000(date: Date): number {
  return date.getTime() / 86_400_000 - 10957.5
}

/** Greenwich mean sidereal time, degrees. */
function gmst(date: Date): number {
  const d = j2000(date)
  return ((280.46061837 + 360.98564736629 * d) % 360 + 360) % 360
}

export interface SkyPos {
  /** altitude above horizon, radians */
  alt: number
  /** azimuth from north through east, radians */
  az: number
}

/** Convert equatorial (RA/dec, degrees) to local horizontal coordinates. */
export function toHorizontal(
  raDeg: number,
  decDeg: number,
  lat: number,
  lon: number,
  date: Date,
): SkyPos {
  const lst = gmst(date) + lon
  const ha = (lst - raDeg) * DEG
  const phi = lat * DEG
  const dec = decDeg * DEG
  const alt = Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha),
  )
  const az = Math.atan2(
    -Math.cos(dec) * Math.sin(ha),
    Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.cos(ha) * Math.sin(phi),
  )
  return { alt, az: (az + Math.PI * 2) % (Math.PI * 2) }
}

/** Sun's current altitude/azimuth at a location. */
export function sunPosition(lat: number, lon: number, date = new Date()): SkyPos {
  const n = j2000(date)
  const L = (280.46 + 0.9856474 * n) % 360
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG
  const eps = (23.439 - 0.0000004 * n) * DEG
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / DEG
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) / DEG
  return toHorizontal((ra + 360) % 360, dec, lat, lon, date)
}

export interface Star {
  ra: number
  dec: number
  mag: number
}

let catalogPromise: Promise<Star[]> | null = null

/**
 * Bright-star catalog (mag <= 4.5) from the d3-celestial dataset (BSC5, CC-BY).
 * Falls back to an empty list — Stars component then draws nothing rather
 * than lying about the sky.
 */
export function starCatalog(): Promise<Star[]> {
  if (!catalogPromise) {
    catalogPromise = fetch(
      'https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/stars.6.json',
    )
      .then((r) => {
        if (!r.ok) throw new Error(`stars ${r.status}`)
        return r.json()
      })
      .then((data) => {
        const stars: Star[] = []
        for (const f of data.features as {
          properties: { mag: number }
          geometry: { coordinates: [number, number] }
        }[]) {
          const mag = f.properties.mag
          if (mag > 5) continue
          const [raRaw, dec] = f.geometry.coordinates
          stars.push({ ra: ((raRaw % 360) + 360) % 360, dec, mag })
        }
        return stars
      })
      .catch(() => [])
  }
  return catalogPromise
}
