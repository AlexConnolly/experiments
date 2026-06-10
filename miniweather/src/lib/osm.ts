import type { Coords, WorldData } from './types'

/** Radius (m) of real city fetched around the user — covers the 3x3 tile grid. */
export const FETCH_RADIUS = 700

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
]

interface OsmElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
  members?: {
    type: string
    role: string
    geometry?: { lat: number; lon: number }[]
  }[]
}

function buildQuery(lat: number, lon: number): string {
  const dLat = FETCH_RADIUS / 111_320
  const dLon = FETCH_RADIUS / (111_320 * Math.cos((lat * Math.PI) / 180))
  const bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}`
  // equality-only clauses: regex filters queue much longer on public servers
  const greens = [
    ['leisure', 'park'], ['leisure', 'garden'], ['leisure', 'pitch'],
    ['leisure', 'playground'], ['leisure', 'common'],
    ['landuse', 'grass'], ['landuse', 'forest'], ['landuse', 'meadow'],
    ['landuse', 'recreation_ground'], ['landuse', 'village_green'],
    ['landuse', 'cemetery'], ['natural', 'wood'], ['natural', 'scrub'],
    ['natural', 'grassland'],
  ]
  return `[out:json][timeout:20];
(
  way["building"](${bbox});
  way["highway"](${bbox});
  way["railway"](${bbox});
  way["aeroway"](${bbox});
  way["natural"="water"](${bbox});
  way["natural"="coastline"](${bbox});
  way["waterway"](${bbox});
  relation["natural"="water"](${bbox});
  relation["waterway"="riverbank"](${bbox});
${greens.map(([k, v]) => `  way["${k}"="${v}"](${bbox});`).join('\n')}
  node["natural"="tree"](${bbox});
);
out geom;`
}

function hash(n: number): number {
  let x = (n ^ 61) ^ (n >>> 16)
  x = (x + (x << 3)) | 0
  x = x ^ (x >>> 4)
  x = Math.imul(x, 0x27d4eb2d)
  x = x ^ (x >>> 15)
  return (x >>> 0) / 0xffffffff
}

function buildingHeight(tags: Record<string, string>, id: number): number {
  const h = parseFloat(tags['height'] ?? tags['building:height'] ?? '')
  if (Number.isFinite(h) && h > 2) return Math.min(h, 90)
  const levels = parseFloat(tags['building:levels'] ?? '')
  if (Number.isFinite(levels) && levels > 0) return Math.min(levels * 3.3 + 1.5, 90)
  const t = tags['building']
  if (t === 'house' || t === 'detached' || t === 'garage' || t === 'shed')
    return 5 + hash(id) * 3
  if (t === 'apartments' || t === 'office' || t === 'commercial')
    return 14 + hash(id) * 16
  return 7 + hash(id) * 9
}

function roadInfo(
  tags: Record<string, string>,
): { width: number; kind: 'road' | 'path' } | null {
  const hw = tags['highway']
  if (!hw) return null
  switch (hw) {
    case 'motorway':
    case 'trunk':
      return { width: 11, kind: 'road' }
    case 'primary':
      return { width: 9, kind: 'road' }
    case 'secondary':
      return { width: 8, kind: 'road' }
    case 'tertiary':
      return { width: 7, kind: 'road' }
    case 'residential':
    case 'unclassified':
    case 'living_street':
      return { width: 5.5, kind: 'road' }
    case 'service':
      return { width: 3.5, kind: 'road' }
    case 'pedestrian':
      return { width: 5, kind: 'path' }
    case 'footway':
    case 'path':
    case 'cycleway':
    case 'track':
    case 'steps':
      return { width: 2, kind: 'path' }
    default:
      return null
  }
}

const CACHE_PREFIX = 'mw-world-v11:'

function cacheKey(coords: Coords): string {
  return `${CACHE_PREFIX}${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}`
}

function readCache(coords: Coords): WorldData | null {
  try {
    const raw = localStorage.getItem(cacheKey(coords))
    if (!raw) return null
    const { at, world } = JSON.parse(raw)
    if (Date.now() - at > 7 * 24 * 3600_000) return null
    return world as WorldData
  } catch {
    return null
  }
}

function writeCache(coords: Coords, world: WorldData) {
  const entry = JSON.stringify({ at: Date.now(), world })
  try {
    localStorage.setItem(cacheKey(coords), entry)
  } catch {
    // quota: drop all world caches and retry once
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i)
        if (k?.startsWith(CACHE_PREFIX)) localStorage.removeItem(k)
      }
      localStorage.setItem(cacheKey(coords), entry)
    } catch {
      /* give up quietly */
    }
  }
}

export async function fetchWorld(coords: Coords): Promise<WorldData> {
  const cached = readCache(coords)
  if (cached) return cached

  const query = buildQuery(coords.lat, coords.lon)
  // race the mirrors with staggered starts: first success wins, losers abort
  const controllers = ENDPOINTS.map(() => new AbortController())
  const attempts = ENDPOINTS.map((endpoint, i) =>
    (async () => {
      if (i > 0) await new Promise((r) => setTimeout(r, i * 4000))
      if (controllers[i].signal.aborted) throw new Error('aborted')
      const timer = setTimeout(() => controllers[i].abort(), 18_000 + i * 4000)
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: controllers[i].signal,
        })
        if (!res.ok) throw new Error(`overpass ${res.status}`)
        return (await res.json()).elements as OsmElement[]
      } finally {
        clearTimeout(timer)
      }
    })(),
  )
  try {
    const elements = await Promise.any(attempts)
    controllers.forEach((c) => c.abort())
    const world = parse(elements, coords)
    writeCache(coords, world)
    return world
  } catch (err) {
    throw err instanceof AggregateError ? err.errors[0] : err
  }
}

function parse(elements: OsmElement[], origin: Coords): WorldData {
  const mPerLon = 111_320 * Math.cos((origin.lat * Math.PI) / 180)
  // 0.1 m precision keeps the cached JSON small enough for localStorage
  const project = (lat: number, lon: number): [number, number] => [
    Math.round((lon - origin.lon) * mPerLon * 10) / 10,
    Math.round(-(lat - origin.lat) * 110_540 * 10) / 10,
  ]

  const world: WorldData = {
    buildings: [],
    roads: [],
    water: [],
    waterways: [],
    rails: [],
    aeroways: [],
    aprons: [],
    green: [],
    trees: [],
  }
  const residential: [number, number][][] = []
  const coastSegs: [number, number][][] = []

  for (const el of elements) {
    if (el.type === 'node' && el.tags?.['natural'] === 'tree' && el.lat && el.lon) {
      world.trees.push(project(el.lat, el.lon))
      continue
    }
    if (el.type === 'relation' && el.members) {
      // big rivers/lakes are multipolygon relations: stitch outer ways into rings
      const segments = el.members
        .filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry)
        .map((m) => m.geometry!.map((g) => project(g.lat, g.lon)))
      for (const ring of stitchRings(segments)) world.water.push(ring)
      continue
    }
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue
    const tags = el.tags ?? {}
    const pts = el.geometry.map((g) => project(g.lat, g.lon))
    const closed =
      pts.length > 3 &&
      pts[0][0] === pts[pts.length - 1][0] &&
      pts[0][1] === pts[pts.length - 1][1]

    if (tags['building'] && closed) {
      world.buildings.push({
        footprint: pts.slice(0, -1),
        height: Math.round(buildingHeight(tags, el.id) * 10) / 10,
      })
      continue
    }
    const aeroway = tags['aeroway']
    if (aeroway) {
      if (aeroway === 'runway') {
        const w = parseFloat(tags['width'] ?? '')
        world.aeroways.push({
          path: pts,
          width: Number.isFinite(w) && w > 10 ? Math.min(w, 80) : 45,
          kind: 'runway',
        })
      } else if (aeroway === 'taxiway') {
        world.aeroways.push({ path: pts, width: 20, kind: 'taxiway' })
      } else if (closed && (aeroway === 'apron' || aeroway === 'helipad')) {
        world.aprons.push(pts.slice(0, -1))
      }
      continue
    }
    const railway = tags['railway']
    if (railway) {
      // surface heavy/light rail only — never draw the underground overground
      const surface =
        (railway === 'rail' || railway === 'light_rail' || railway === 'tram' ||
          railway === 'narrow_gauge') &&
        (!tags['tunnel'] || tags['tunnel'] === 'no') &&
        tags['covered'] !== 'yes' &&
        tags['location'] !== 'underground'
      if (surface)
        world.rails.push({
          path: pts,
          bridge: !!tags['bridge'] && tags['bridge'] !== 'no',
        })
      continue
    }
    const road = roadInfo(tags)
    if (road) {
      // underground roads (tunnels, covered passages) never render
      const buried =
        (tags['tunnel'] && tags['tunnel'] !== 'no') ||
        tags['covered'] === 'yes' ||
        tags['location'] === 'underground'
      if (!buried)
        world.roads.push({
          path: pts,
          ...road,
          bridge: !!tags['bridge'] && tags['bridge'] !== 'no',
        })
      continue
    }
    if (tags['natural'] === 'coastline') {
      coastSegs.push(pts)
      continue
    }
    if (tags['natural'] === 'water' || tags['waterway'] === 'riverbank') {
      if (closed) world.water.push(pts.slice(0, -1))
      continue
    }
    if (tags['waterway']) {
      // open waterway centreline -> thicken into a polygon
      world.water.push(thickenLine(pts, tags['waterway'] === 'stream' ? 4 : 12))
      if (tags['waterway'] === 'river' || tags['waterway'] === 'canal')
        world.waterways.push(pts)
      continue
    }
    if (closed && tags['landuse'] === 'residential') {
      residential.push(pts.slice(0, -1))
      continue
    }
    if (closed && (tags['leisure'] || tags['landuse'] || tags['natural'])) {
      world.green.push(pts.slice(0, -1))
    }
  }

  // the open sea isn't a polygon in OSM — close coastlines against the bbox
  buildSea(world, coastSegs)

  // villages often have estates mapped as landuse but no house footprints:
  // fill the gap with plausible houses along the roads
  synthesizeHouses(world, residential)

  // keep the scene mobile-friendly
  world.buildings.sort(
    (a, b) =>
      centroidDist(a.footprint) - centroidDist(b.footprint),
  )
  // high cap so residential terraces in the outer ring survive, not just the core
  world.buildings = world.buildings.slice(0, 8000)
  world.trees = world.trees.slice(0, 550)
  return world
}

function pointInPoly(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      inside = !inside
  }
  return inside
}

/**
 * OSM maps the coast as open `natural=coastline` ways (land left, water
 * right) — the sea itself has no polygon. Stitch the segments, then close
 * each long coastline against the bbox both ways and keep whichever side
 * contains fewer buildings: that's the sea.
 */
function buildSea(world: WorldData, segs: [number, number][][]) {
  if (!segs.length) return
  const EPS = 1.5
  const near = (a: [number, number], b: [number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS
  const pool = segs.filter((s) => s.length >= 2).map((s) => s.slice())
  const lines: [number, number][][] = []
  while (pool.length) {
    const line = pool.pop()!
    let extended = true
    while (extended) {
      extended = false
      for (let i = 0; i < pool.length; i++) {
        const seg = pool[i]
        const head = line[0]
        const tail = line[line.length - 1]
        if (near(seg[0], tail)) line.push(...seg.slice(1))
        else if (near(seg[seg.length - 1], tail)) line.push(...seg.slice(0, -1).reverse())
        else if (near(seg[seg.length - 1], head)) line.unshift(...seg.slice(0, -1))
        else if (near(seg[0], head)) line.unshift(...seg.slice(1).reverse())
        else continue
        pool.splice(i, 1)
        extended = true
        break
      }
    }
    lines.push(line)
  }

  const L = 690
  const P = 8 * L
  const clampPt = ([x, z]: [number, number]): [number, number] => [
    Math.max(-L, Math.min(L, x)),
    Math.max(-L, Math.min(L, z)),
  ]
  const perim = ([x, z]: [number, number]): number => {
    const dTop = Math.abs(z + L)
    const dRight = Math.abs(x - L)
    const dBottom = Math.abs(z - L)
    const dLeft = Math.abs(x + L)
    const m = Math.min(dTop, dRight, dBottom, dLeft)
    if (m === dTop) return x + L
    if (m === dRight) return 2 * L + (z + L)
    if (m === dBottom) return 4 * L + (L - x)
    return 6 * L + (L - z)
  }
  const pointAtPerim = (s: number): [number, number] => {
    s = ((s % P) + P) % P
    if (s < 2 * L) return [s - L, -L]
    if (s < 4 * L) return [L, s - 3 * L]
    if (s < 6 * L) return [5 * L - s, L]
    return [-L, 7 * L - s]
  }

  const centroids: [number, number][] = world.buildings.slice(0, 600).map((b) => {
    let x = 0
    let z = 0
    for (const p of b.footprint) {
      x += p[0]
      z += p[1]
    }
    return [x / b.footprint.length, z / b.footprint.length]
  })

  const candidates = lines
    .filter((l) => {
      if (l.length < 2 || near(l[0], l[l.length - 1])) return false
      let len = 0
      for (let i = 1; i < l.length; i++)
        len += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1])
      return len > 250
    })
    .slice(0, 2)

  for (const line of candidates) {
    const path = line.map(clampPt)
    const sEntry = perim(path[0])
    const sExit = perim(path[path.length - 1])
    const close = (dir: 1 | -1): [number, number][] => {
      const ring = path.slice()
      let s = sExit
      for (let guard = 0; guard < 5; guard++) {
        const toTarget = (((dir === 1 ? sEntry - s : s - sEntry) % P) + P) % P
        const nextCorner =
          dir === 1
            ? (Math.floor(s / (2 * L) + 1e-7) + 1) * 2 * L
            : (Math.ceil(s / (2 * L) - 1e-7) - 1) * 2 * L
        const toCorner = (((dir === 1 ? nextCorner - s : s - nextCorner) % P) + P) % P
        if (toTarget <= toCorner || toTarget < 0.01) break
        s = ((nextCorner % P) + P) % P
        ring.push(pointAtPerim(s))
      }
      return ring
    }
    const ringA = close(1)
    const ringB = close(-1)
    const count = (ring: [number, number][]) => {
      let c = 0
      for (const [x, z] of centroids) if (pointInPoly(x, z, ring)) c++
      return c
    }
    const a = count(ringA)
    const b = count(ringB)
    if (a === b) continue
    world.water.push(a < b ? ringA : ringB)
  }
}

/**
 * Place small houses along roads inside residential land-use where OSM has
 * no building footprints. Real buildings occupy a coarse grid, so anywhere
 * actually mapped stays untouched.
 */
function synthesizeHouses(world: WorldData, residential: [number, number][][]) {
  if (!residential.length) return
  const CELL = 18
  const occupied = new Set<string>()
  const key = (x: number, z: number) =>
    `${Math.round(x / CELL)},${Math.round(z / CELL)}`
  const mark = (x: number, z: number) => {
    const cx = Math.round(x / CELL)
    const cz = Math.round(z / CELL)
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) occupied.add(`${cx + dx},${cz + dz}`)
  }
  for (const b of world.buildings) {
    let x = 0
    let z = 0
    for (const p of b.footprint) {
      x += p[0]
      z += p[1]
    }
    mark(x / b.footprint.length, z / b.footprint.length)
  }

  let made = 0
  let seed = 1
  for (const r of world.roads) {
    if (r.kind !== 'road' || r.bridge || r.width > 7.5) continue
    for (let i = 1; i < r.path.length && made < 1600; i++) {
      const [ax, az] = r.path[i - 1]
      const [bx, bz] = r.path[i]
      const segLen = Math.hypot(bx - ax, bz - az)
      if (segLen < 12) continue
      const dx = (bx - ax) / segLen
      const dz = (bz - az) / segLen
      for (let s = 10; s < segLen - 6; s += 24) {
        const x = ax + dx * s
        const z = az + dz * s
        if (!residential.some((p) => pointInPoly(x, z, p))) continue
        for (const side of [-1, 1]) {
          seed++
          if (hash(seed * 17) > 0.88) continue
          const off = r.width / 2 + 7.5
          const hx = x - dz * off * side
          const hz = z + dx * off * side
          if (Math.abs(hx) > 680 || Math.abs(hz) > 680) continue
          if (occupied.has(key(hx, hz))) continue
          const w = 4.5 + hash(seed * 3) * 1.6
          const d = 4 + hash(seed * 7) * 1.6
          const vx = -dz * side
          const vz = dx * side
          const fp: [number, number][] = (
            [
              [hx - dx * w - vx * d, hz - dz * w - vz * d],
              [hx + dx * w - vx * d, hz + dz * w - vz * d],
              [hx + dx * w + vx * d, hz + dz * w + vz * d],
              [hx - dx * w + vx * d, hz - dz * w + vz * d],
            ] as [number, number][]
          ).map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10])
          world.buildings.push({
            footprint: fp,
            height: Math.round((4.5 + hash(seed * 11) * 2.5) * 10) / 10,
          })
          mark(hx, hz)
          made++
        }
      }
    }
    if (made >= 1600) break
  }
}

function centroidDist(pts: [number, number][]): number {
  let x = 0
  let z = 0
  for (const p of pts) {
    x += p[0]
    z += p[1]
  }
  x /= pts.length
  z /= pts.length
  return Math.hypot(x, z)
}

/** Join way segments end-to-end into closed rings (multipolygon outers). */
function stitchRings(segments: [number, number][][]): [number, number][][] {
  const EPS = 1.5
  const near = (a: [number, number], b: [number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS
  const pool = segments.filter((s) => s.length >= 2)
  const rings: [number, number][][] = []
  while (pool.length) {
    const ring = pool.pop()!.slice()
    let extended = true
    while (extended && !near(ring[0], ring[ring.length - 1])) {
      extended = false
      for (let i = 0; i < pool.length; i++) {
        const seg = pool[i]
        const end = ring[ring.length - 1]
        if (near(seg[0], end)) {
          ring.push(...seg.slice(1))
        } else if (near(seg[seg.length - 1], end)) {
          ring.push(...seg.slice(0, -1).reverse())
        } else {
          continue
        }
        pool.splice(i, 1)
        extended = true
        break
      }
    }
    // accept closed rings, and long open banks too. Clamp to the tile grid so
    // huge river polygons end flush with the plinth edge.
    const LIMIT = 690
    if (ring.length >= 4)
      rings.push(
        ring.map(([x, z]) => [
          Math.max(-LIMIT, Math.min(LIMIT, x)),
          Math.max(-LIMIT, Math.min(LIMIT, z)),
        ]),
      )
  }
  return rings
}

/** Turn an open polyline into a closed polygon of the given width. */
function thickenLine(path: [number, number][], width: number): [number, number][] {
  const half = width / 2
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let i = 0; i < path.length; i++) {
    const [px, pz] = path[Math.max(0, i - 1)]
    const [nx, nz] = path[Math.min(path.length - 1, i + 1)]
    const len = Math.hypot(nx - px, nz - pz) || 1
    const dx = (nx - px) / len
    const dz = (nz - pz) / len
    left.push([path[i][0] - dz * half, path[i][1] + dx * half])
    right.push([path[i][0] + dz * half, path[i][1] - dx * half])
  }
  return [...left, ...right.reverse()]
}
