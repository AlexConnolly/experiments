import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { WorldData } from '../lib/types'
import type { Theme } from '../lib/theme'
import {
  WINDOW_REPEAT,
  asphaltTexture,
  flickerNightWindows,
  grassTexture,
  pavingTexture,
  railTexture,
  runwayTexture,
  waterTexture,
  windowDayTexture,
  windowNightTexture,
} from '../lib/textures'
import { buildCacheKey, buildUniform, easeOutBack, patchBuildMaterial, setColor, setDelay, setGround, setRate } from './buildAnim'
import type { Terrain } from '../lib/terrain'

/** One tile is HALF metres from centre to edge; the world is a 3x3 grid of tiles. */
export const HALF = 230
export const TILE = HALF * 2
/** Outer edge of the full 3x3 grid. */
export const WORLD_HALF = HALF * 3

export const clipPlanes = [
  new THREE.Plane(new THREE.Vector3(1, 0, 0), WORLD_HALF),
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), WORLD_HALF),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), WORLD_HALF),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), WORLD_HALF),
]

const WALL_PALETTE = [
  '#f2e3cf', '#e8d0bb', '#f0d4cf', '#d8e4ea', '#e6e0cc', '#ded3e6',
  '#eedcc0', '#d5e2d0', '#e3c9b2', '#dfc8c2', '#cdd9e2', '#e9e2cf',
]
const ROOF_PALETTE = [
  '#b06a4f', '#9a5a44', '#8a8d96', '#6e7480', '#a3795a', '#7d8a75', '#c08a62', '#9aa0a8',
]
const TREE_GREENS = ['#7fae6e', '#699e5b', '#8db773', '#5d8f57', '#9cc183', '#74a86a']

function hash(n: number): number {
  let x = (n ^ 61) ^ (n >>> 16)
  x = (x + (x << 3)) | 0
  x = x ^ (x >>> 4)
  x = Math.imul(x, 0x27d4eb2d)
  x = x ^ (x >>> 15)
  return (x >>> 0) / 0xffffffff
}

function shapeFrom(footprint: [number, number][]): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(footprint[0][0], -footprint[0][1])
  for (let i = 1; i < footprint.length; i++)
    shape.lineTo(footprint[i][0], -footprint[i][1])
  shape.closePath()
  return shape
}

function flatPolygons(
  polys: [number, number][][],
  y: number,
  terrain: Terrain,
): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = []
  for (const poly of polys) {
    if (poly.length < 3) continue
    try {
      const g = new THREE.ShapeGeometry(shapeFrom(poly))
      g.rotateX(-Math.PI / 2)
      const pos = g.attributes.position
      for (let i = 0; i < pos.count; i++)
        pos.setY(i, terrain.h(pos.getX(i), pos.getZ(i)) + y)
      parts.push(g.toNonIndexed())
    } catch {
      /* skip degenerate polygons */
    }
  }
  if (!parts.length) return null
  const merged = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  return merged
}

/** Insert points so no segment is longer than maxLen — lets ribbons follow terrain. */
function resample(path: [number, number][], maxLen = 18): [number, number][] {
  const out: [number, number][] = [path[0]]
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1]
    const [bx, bz] = path[i]
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.ceil(len / maxLen))
    for (let k = 1; k <= n; k++)
      out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n])
  }
  return out
}

/**
 * Ribbon along a polyline, u = metres/8 along its length.
 * 'drape' follows the terrain underneath; 'span' (bridges) runs straight
 * from the height of one end to the other.
 */
function ribbon(
  rawPath: [number, number][],
  width: number,
  y: number,
  terrain: Terrain,
  mode: 'drape' | 'span' = 'drape',
): THREE.BufferGeometry | null {
  if (rawPath.length < 2) return null
  const path = resample(rawPath)
  let total = 0
  for (let i = 1; i < path.length; i++)
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  const h0 = terrain.h(path[0][0], path[0][1])
  const h1 = terrain.h(path[path.length - 1][0], path[path.length - 1][1])
  const half = width / 2
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let dist = 0
  for (let i = 0; i < path.length; i++) {
    if (i > 0) {
      dist += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
    }
    const [px, pz] = path[Math.max(0, i - 1)]
    const [nx, nz] = path[Math.min(path.length - 1, i + 1)]
    const len = Math.hypot(nx - px, nz - pz) || 1
    const dx = (nx - px) / len
    const dz = (nz - pz) / len
    const lx = path[i][0] - dz * half
    const lz = path[i][1] + dx * half
    const rx = path[i][0] + dz * half
    const rz = path[i][1] - dx * half
    const spanH = h0 + (h1 - h0) * (total > 0 ? dist / total : 0)
    positions.push(lx, (mode === 'span' ? spanH : terrain.h(lx, lz)) + y, lz)
    positions.push(rx, (mode === 'span' ? spanH : terrain.h(rx, rz)) + y, rz)
    uvs.push(dist / 8, 0, dist / 8, 1)
    if (i > 0) {
      const a = (i - 1) * 2
      // counter-clockwise from above, so faces point up and aren't culled
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g.toNonIndexed()
}

function mergedRibbons(
  roads: WorldData['roads'],
  y: number,
  terrain: Terrain,
  filter: (r: WorldData['roads'][number]) => boolean,
  widen = 0,
  mode: 'drape' | 'span' = 'drape',
): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = []
  let idx = 0
  for (const r of roads) {
    if (!filter(r)) continue
    // tiny per-way height jitter so overlapping ribbons never z-fight
    const g = ribbon(r.path, r.width + widen, y + (idx++ % 5) * 0.02, terrain, mode)
    if (g) parts.push(g)
  }
  if (!parts.length) return null
  const merged = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  return merged
}

/** Split an extruded building into roof and wall triangles by face normal. */
function splitRoofWalls(geo: THREE.BufferGeometry): {
  roof: THREE.BufferGeometry
  wall: THREE.BufferGeometry
} {
  const pos = geo.attributes.position.array as Float32Array
  const nor = geo.attributes.normal.array as Float32Array
  const uv = geo.attributes.uv.array as Float32Array
  const roofP: number[] = []
  const roofN: number[] = []
  const roofU: number[] = []
  const wallP: number[] = []
  const wallN: number[] = []
  const wallU: number[] = []
  const triCount = pos.length / 9
  for (let t = 0; t < triCount; t++) {
    const ny = (nor[t * 9 + 1] + nor[t * 9 + 4] + nor[t * 9 + 7]) / 3
    const [P, N, U] = Math.abs(ny) > 0.7 ? [roofP, roofN, roofU] : [wallP, wallN, wallU]
    for (let k = 0; k < 9; k++) {
      P.push(pos[t * 9 + k])
      N.push(nor[t * 9 + k])
    }
    for (let k = 0; k < 6; k++) U.push(uv[t * 6 + k])
  }
  const make = (p: number[], n: number[], u: number[]) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2))
    return g
  }
  return { roof: make(roofP, roofN, roofU), wall: make(wallP, wallN, wallU) }
}

function centroidOf(pts: [number, number][]): [number, number] {
  let x = 0
  let z = 0
  for (const p of pts) {
    x += p[0]
    z += p[1]
  }
  return [x / pts.length, z / pts.length]
}

export interface Exclusion {
  x: number
  z: number
  clearRadius: number
}

/**
 * All buildings merged into one wall + one roof geometry with per-building
 * vertex colours (variation) and per-building build-in delays. Buildings
 * standing on a landmark site are dropped so the model isn't buried.
 */
function buildCity(
  buildings: WorldData['buildings'],
  exclusions: Exclusion[],
  terrain: Terrain,
): {
  wall: THREE.BufferGeometry | null
  roof: THREE.BufferGeometry | null
} {
  const walls: THREE.BufferGeometry[] = []
  const roofs: THREE.BufferGeometry[] = []
  const color = new THREE.Color()
  buildings.forEach((b, i) => {
    if (b.footprint.length < 3) return
    const [ecx, ecz] = centroidOf(b.footprint)
    if (exclusions.some((e) => Math.hypot(ecx - e.x, ecz - e.z) < e.clearRadius)) return
    try {
      // extend the extrusion 3 m below grade so slopes never show a gap
      const g = new THREE.ExtrudeGeometry(shapeFrom(b.footprint), {
        depth: b.height + 3,
        bevelEnabled: false,
      })
      g.rotateX(-Math.PI / 2)
      const gH = terrain.h(ecx, ecz)
      g.translate(0, gH - 3, 0)
      const { roof, wall } = splitRoofWalls(g.toNonIndexed())
      g.dispose()
      // everything releases together; each building falls at its own pace
      const delay = hash(i * 3 + 1) * 0.35
      const rate = 0.7 + hash(i * 9 + 4) * 0.7
      const jitter = 0.9 + hash(i * 5 + 2) * 0.18

      color.set(WALL_PALETTE[Math.floor(hash(i * 7 + 13) * WALL_PALETTE.length)])
      color.multiplyScalar(jitter)
      setColor(wall, color)
      setDelay(wall, delay)
      setRate(wall, rate)
      setGround(wall, gH)
      walls.push(wall)

      color.set(ROOF_PALETTE[Math.floor(hash(i * 11 + 5) * ROOF_PALETTE.length)])
      color.multiplyScalar(0.9 + hash(i * 13 + 7) * 0.2)
      setColor(roof, color)
      setDelay(roof, delay)
      setRate(roof, rate)
      setGround(roof, gH)
      roofs.push(roof)
    } catch {
      /* skip degenerate footprints */
    }
  })
  const mergeAll = (parts: THREE.BufferGeometry[]) => {
    if (!parts.length) return null
    const merged = mergeGeometries(parts)
    parts.forEach((p) => p.dispose())
    return merged
  }
  return { wall: mergeAll(walls), roof: mergeAll(roofs) }
}

/** Deterministically scatter extra trees inside green areas. */
function scatterTrees(green: [number, number][][], existing: [number, number][]): [number, number][] {
  const result = [...existing]
  green.forEach((poly, pi) => {
    if (poly.length < 3 || result.length > 750) return
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const [x, z] of poly) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
    }
    const area = (maxX - minX) * (maxZ - minZ)
    const want = Math.min(6, Math.floor(area / 1800))
    let placed = 0
    for (let t = 0; t < want * 8 && placed < want; t++) {
      const x = minX + hash(pi * 131 + t * 2) * (maxX - minX)
      const z = minZ + hash(pi * 131 + t * 2 + 1) * (maxZ - minZ)
      if (pointInPolygon(x, z, poly)) {
        result.push([x, z])
        placed++
      }
    }
  })
  return result
}

function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      inside = !inside
  }
  return inside
}

interface TreeEntry {
  x: number
  z: number
  /** ground height under this tree */
  g: number
  s: number
  stretch: number
  pine: boolean
  color: THREE.Color
  delay: number
}

function Trees({
  spots,
  theme,
  terrain,
}: {
  spots: [number, number][]
  theme: Theme
  terrain: Terrain
}) {
  const trunks = useRef<THREE.InstancedMesh>(null)
  const blobs = useRef<THREE.InstancedMesh>(null)
  const pines = useRef<THREE.InstancedMesh>(null)

  const entries = useMemo<TreeEntry[]>(() => {
    return spots
      .filter(([x, z]) => Math.abs(x) < WORLD_HALF - 2 && Math.abs(z) < WORLD_HALF - 2)
      .map(([x, z], i) => {
        const base = new THREE.Color(TREE_GREENS[Math.floor(hash(i * 19) * TREE_GREENS.length)])
        base.multiplyScalar(0.88 + hash(i * 23) * 0.26)
        if (theme.snowGround) base.lerp(new THREE.Color('#dfe9e3'), 0.7)
        return {
          x,
          z,
          g: terrain.h(x, z),
          s: 0.7 + hash(i * 37) * 0.8,
          stretch: 0.85 + hash(i * 3) * 0.55,
          pine: hash(i * 41) < 0.28,
          color: base,
          delay: hash(i * 43) * 0.6,
        }
      })
  }, [spots, theme.snowGround, terrain])

  const { blobEntries, pineEntries, maxDelay } = useMemo(() => {
    const blobEntries = entries.filter((e) => !e.pine)
    const pineEntries = entries.filter((e) => e.pine)
    const maxDelay = entries.reduce((a, e) => Math.max(a, e.delay), 0)
    return { blobEntries, pineEntries, maxDelay }
  }, [entries])

  const trunksSettled = useRef(false)

  useFrame(({ clock }) => {
    if (!trunks.current || !blobs.current || !pines.current) return
    const t = buildUniform.value
    const ct = clock.elapsedTime
    const building = t < maxDelay + 1.2

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const sway = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const sc = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const tilt = new THREE.Vector3(1, 0, 0.6).normalize()

    const grow = (e: TreeEntry) =>
      Math.max(0.001, easeOutBack(THREE.MathUtils.clamp((t - e.delay) / 0.8, 0, 1)))

    // trunks only move while growing in
    if (building || !trunksSettled.current) {
      trunksSettled.current = !building
      entries.forEach((e, i) => {
        const g = grow(e)
        q.setFromAxisAngle(up, hash(i) * Math.PI)
        p.set(e.x, e.g + 1.5 * e.s * g, e.z)
        sc.set(e.s, e.s * g, e.s)
        m.compose(p, q, sc)
        trunks.current!.setMatrixAt(i, m)
      })
      trunks.current.instanceMatrix.needsUpdate = true
    }

    // canopies keep a gentle breeze sway forever
    blobEntries.forEach((e, i) => {
      const g = grow(e)
      q.setFromAxisAngle(up, hash(i * 2) * Math.PI)
      sway.setFromAxisAngle(tilt, Math.sin(ct * 1.1 + e.x * 0.05 + e.z * 0.04) * 0.045)
      q.premultiply(sway)
      p.set(e.x, e.g + (3 + 1.9 * e.stretch) * e.s * g, e.z)
      sc.set(e.s, e.s * e.stretch * g, e.s)
      m.compose(p, q, sc)
      blobs.current!.setMatrixAt(i, m)
    })
    pineEntries.forEach((e, i) => {
      const g = grow(e)
      q.setFromAxisAngle(up, hash(i * 4) * Math.PI)
      sway.setFromAxisAngle(tilt, Math.sin(ct * 1.3 + e.x * 0.06) * 0.03)
      q.premultiply(sway)
      p.set(e.x, e.g + (2.6 + 3 * e.stretch) * e.s * g, e.z)
      sc.set(e.s, e.s * e.stretch * g, e.s)
      m.compose(p, q, sc)
      pines.current!.setMatrixAt(i, m)
    })
    blobs.current.instanceMatrix.needsUpdate = true
    pines.current.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh
        key={`t${entries.length}`}
        ref={trunks}
        args={[undefined, undefined, entries.length]}
        castShadow
      >
        <cylinderGeometry args={[0.45, 0.6, 3, 5]} />
        <meshStandardMaterial color="#8a6a4f" roughness={0.9} clippingPlanes={clipPlanes} />
      </instancedMesh>
      <instancedMesh
        key={`b${blobEntries.length}${theme.snowGround}`}
        ref={(mesh) => {
          blobs.current = mesh
          if (mesh) {
            blobEntries.forEach((e, i) => mesh.setColorAt(i, e.color))
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
          }
        }}
        args={[undefined, undefined, blobEntries.length]}
        castShadow
      >
        <icosahedronGeometry args={[2.7, 1]} />
        <meshStandardMaterial roughness={0.95} flatShading clippingPlanes={clipPlanes} />
      </instancedMesh>
      <instancedMesh
        key={`p${pineEntries.length}${theme.snowGround}`}
        ref={(mesh) => {
          pines.current = mesh
          if (mesh) {
            pineEntries.forEach((e, i) => mesh.setColorAt(i, e.color))
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
          }
        }}
        args={[undefined, undefined, pineEntries.length]}
        castShadow
      >
        <coneGeometry args={[2.3, 7, 7]} />
        <meshStandardMaterial roughness={0.95} flatShading clippingPlanes={clipPlanes} />
      </instancedMesh>
    </>
  )
}

/** Overhead line equipment so rail reads unmistakably as rail. */
function RailCatenary({ world, terrain }: { world: WorldData; terrain: Terrain }) {
  const { masts, wireGeo } = useMemo(() => {
    const masts: THREE.Matrix4[] = []
    const wire: number[] = []
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const sc = new THREE.Vector3(1, 1, 1)
    let side = 1
    for (const rail of world.rails) {
      const path = resample(rail.path, 24)
      const cums = [0]
      for (let i = 1; i < path.length; i++)
        cums.push(
          cums[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]),
        )
      const total = cums[cums.length - 1] || 1
      const h0 = terrain.h(path[0][0], path[0][1])
      const h1 = terrain.h(path[path.length - 1][0], path[path.length - 1][1])
      // bridges span; plain track drapes — same rule as the ribbons
      const groundAt = (i: number) =>
        rail.bridge
          ? h0 + (h1 - h0) * (cums[i] / total) + 3.05
          : terrain.h(path[i][0], path[i][1])
      // contact wire follows the track at mast height
      for (let i = 1; i < path.length; i++) {
        wire.push(
          path[i - 1][0], groundAt(i - 1) + 5.6, path[i - 1][1],
          path[i][0], groundAt(i) + 5.6, path[i][1],
        )
      }
      // masts every ~45 m, alternating sides
      let carry = 18
      for (let i = 1; i < path.length && masts.length < 260; i++) {
        const [ax, az] = path[i - 1]
        const [bx, bz] = path[i]
        const segLen = Math.hypot(bx - ax, bz - az)
        if (segLen < 0.5) continue
        const dx = (bx - ax) / segLen
        const dz = (bz - az) / segLen
        for (let s = carry; s < segLen; s += 45) {
          side = -side
          const mx = ax + dx * s - dz * 2.9 * side
          const mz = az + dz * s + dx * 2.9 * side
          if (Math.abs(mx) > WORLD_HALF - 2 || Math.abs(mz) > WORLD_HALF - 2) continue
          q.setFromAxisAngle(up, Math.atan2(dx, dz))
          masts.push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(mx, groundAt(i - 1) + 3, mz),
              q,
              sc,
            ),
          )
          carry = s + 45 - segLen
        }
        if (carry <= 0 || carry > 45) carry = 18
      }
    }
    const wireGeo = new THREE.BufferGeometry()
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3))
    return { masts, wireGeo }
  }, [world, terrain])

  if (!masts.length) return null
  return (
    <>
      <instancedMesh
        key={`mast${masts.length}`}
        ref={(m) => {
          if (!m) return
          masts.forEach((mat, i) => m.setMatrixAt(i, mat))
          m.instanceMatrix.needsUpdate = true
        }}
        args={[undefined, undefined, masts.length]}
      >
        <boxGeometry args={[0.35, 6, 0.35]} />
        <meshStandardMaterial color="#4b5158" roughness={0.8} clippingPlanes={clipPlanes} />
      </instancedMesh>
      <lineSegments geometry={wireGeo}>
        <lineBasicMaterial color="#3c4148" transparent opacity={0.65} clippingPlanes={clipPlanes} />
      </lineSegments>
    </>
  )
}

export function Diorama({
  world,
  theme,
  isDay,
  terrain,
  exclusions = [],
}: {
  world: WorldData
  theme: Theme
  isDay: boolean
  terrain: Terrain
  exclusions?: Exclusion[]
}) {
  const city = useMemo(
    () => buildCity(world.buildings, exclusions, terrain),
    [world, exclusions, terrain],
  )
  const roadsGeo = useMemo(
    () => mergedRibbons(world.roads, 0.22, terrain, (r) => r.kind === 'road' && !r.bridge),
    [world, terrain],
  )
  const pathsGeo = useMemo(
    () => mergedRibbons(world.roads, 0.3, terrain, (r) => r.kind === 'path' && !r.bridge),
    [world, terrain],
  )
  // rails rendered like roads, including their own bridges
  const railRoads = useMemo(
    () =>
      world.rails.map((r) => ({
        path: r.path,
        width: 4.4,
        kind: 'road' as const,
        bridge: r.bridge,
      })),
    [world],
  )
  const railsGeo = useMemo(
    () => mergedRibbons(railRoads, 0.27, terrain, (r) => !r.bridge),
    [railRoads, terrain],
  )
  const railBridgeGeo = useMemo(
    () => mergedRibbons(railRoads, 3.05, terrain, (r) => !!r.bridge, 0, 'span'),
    [railRoads, terrain],
  )
  // airport surfaces
  const runwayGeo = useMemo(
    () =>
      mergedRibbons(
        world.aeroways.map((a) => ({ path: a.path, width: a.width, kind: 'road' as const })),
        0.24,
        terrain,
        (r) => r.width > 25,
      ),
    [world, terrain],
  )
  const taxiwayGeo = useMemo(
    () =>
      mergedRibbons(
        world.aeroways.map((a) => ({ path: a.path, width: a.width, kind: 'road' as const })),
        0.18,
        terrain,
        (r) => r.width <= 25,
      ),
    [world, terrain],
  )
  const apronGeo = useMemo(() => flatPolygons(world.aprons, 0.1, terrain), [world, terrain])
  // bridges span bank to bank on a chunky stone deck — never draped into the dip
  const bridgeGeo = useMemo(
    () => mergedRibbons(world.roads, 3.0, terrain, (r) => !!r.bridge, 0, 'span'),
    [world, terrain],
  )
  const bridgeDeckGeo = useMemo(
    () =>
      mergedRibbons(
        [...world.roads, ...railRoads],
        2.2,
        terrain,
        (r) => !!r.bridge,
        2.4,
        'span',
      ),
    [world, railRoads, terrain],
  )
  const waterGeo = useMemo(() => flatPolygons(world.water, 0.14, terrain), [world, terrain])
  const greenGeo = useMemo(() => flatPolygons(world.green, 0.08, terrain), [world, terrain])

  // the ground itself: a displaced heightfield with earthen skirts
  const groundGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(TILE * 3, TILE * 3, 48, 48)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++)
      pos.setY(i, terrain.h(pos.getX(i), pos.getZ(i)))
    g.computeVertexNormals()
    return g
  }, [terrain])
  const skirtGeo = useMemo(() => {
    const bottom = terrain.min - 22
    const positions: number[] = []
    const indices: number[] = []
    const SEG = 48
    const edgePoint = (e: number, i: number): [number, number] => {
      const t = -WORLD_HALF + (i / SEG) * TILE * 3
      if (e === 0) return [t, -WORLD_HALF]
      if (e === 1) return [WORLD_HALF, t]
      if (e === 2) return [-t, WORLD_HALF]
      return [-WORLD_HALF, -t]
    }
    for (let e = 0; e < 4; e++) {
      const base = positions.length / 3
      for (let i = 0; i <= SEG; i++) {
        const [x, z] = edgePoint(e, i)
        positions.push(x, terrain.h(x, z), z, x, bottom, z)
      }
      for (let i = 0; i < SEG; i++) {
        const a = base + i * 2
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setIndex(indices)
    g.computeVertexNormals()
    return g
  }, [terrain])
  const treeSpots = useMemo(
    () => scatterTrees(world.green, world.trees),
    [world],
  )

  const tx = useMemo(() => {
    const windowDay = windowDayTexture()
    const windowNight = windowNightTexture()
    windowDay.repeat.set(...WINDOW_REPEAT)
    windowNight.repeat.set(...WINDOW_REPEAT)
    const water = waterTexture()
    water.repeat.set(1 / 30, 1 / 30)
    const grass = grassTexture()
    grass.repeat.set(1 / 18, 1 / 18)
    const paving = pavingTexture()
    paving.repeat.set(70, 70)
    return {
      windowDay,
      windowNight,
      asphalt: asphaltTexture(),
      rail: railTexture(),
      runway: runwayTexture(),
      water,
      grass,
      paving,
    }
  }, [])

  useEffect(() => {
    try {
      const sphere = roadsGeo
        ? (roadsGeo.computeBoundingSphere(), roadsGeo.boundingSphere)
        : null
      localStorage.setItem(
        'mw-debug',
        JSON.stringify({
          roadVerts: roadsGeo?.attributes.position.count ?? null,
          pathVerts: pathsGeo?.attributes.position.count ?? null,
          bridgeVerts: bridgeGeo?.attributes.position.count ?? null,
          roadsInData: world.roads.filter((r) => r.kind === 'road').length,
          bridgeFlags: world.roads.filter((r) => r.bridge).length,
          roadSphere: sphere
            ? { c: sphere.center.toArray(), r: sphere.radius }
            : null,
        }),
      )
    } catch {
      /* diagnostics only */
    }
  }, [roadsGeo, pathsGeo, bridgeGeo, world])

  const flickerAcc = useRef(0)
  useFrame((_, dt) => {
    // drifting water
    tx.water.offset.x += dt * 0.013
    tx.water.offset.y += dt * 0.007
    // at night the odd household turns a light on or off
    if (!isDay) {
      flickerAcc.current += dt
      if (flickerAcc.current > 1.6) {
        flickerAcc.current = 0
        flickerNightWindows()
      }
    }
  })

  const groundTop = theme.snowGround ? '#eef3f7' : theme.wet ? '#aaa192' : '#d4c9b4'
  const greenColor = theme.snowGround ? '#dfe9e3' : '#86ba70'
  const roadLine = theme.snowGround ? '#e3eaf1' : theme.wet ? '#99a1ad' : '#bbc0c8'
  const pathColor = theme.snowGround ? '#c2ccd2' : '#c4b394'
  const waterColor = theme.snowGround ? '#a8c8da' : '#4f9fd4'

  return (
    <group>
      {/* the ground: real terrain heightfield on an earthen plinth */}
      <mesh geometry={groundGeo} receiveShadow>
        <meshStandardMaterial color={groundTop} map={tx.paving} roughness={0.95} />
      </mesh>
      <mesh geometry={skirtGeo}>
        <meshStandardMaterial color="#7a6450" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {greenGeo && (
        <mesh geometry={greenGeo} receiveShadow>
          <meshStandardMaterial
            color={greenColor}
            map={tx.grass}
            roughness={0.95}
            clippingPlanes={clipPlanes}
          />
        </mesh>
      )}
      {waterGeo && (
        <mesh geometry={waterGeo}>
          <meshStandardMaterial
            color={waterColor}
            map={tx.water}
            roughness={0.12}
            metalness={0.25}
            clippingPlanes={clipPlanes}
          />
        </mesh>
      )}
      {roadsGeo && (
        <mesh geometry={roadsGeo} receiveShadow>
          {new URLSearchParams(window.location.search).has('debugroads') ? (
            <meshBasicMaterial color="#ff0000" />
          ) : (
            <meshStandardMaterial
              color={roadLine}
              map={tx.asphalt}
              roughness={0.92}
              clippingPlanes={clipPlanes}
            />
          )}
        </mesh>
      )}
      {pathsGeo && (
        <mesh geometry={pathsGeo} receiveShadow>
          <meshStandardMaterial color={pathColor} roughness={0.95} clippingPlanes={clipPlanes} />
        </mesh>
      )}
      {railsGeo && (
        <mesh geometry={railsGeo} receiveShadow>
          <meshStandardMaterial
            color="#e0bf9a"
            map={tx.rail}
            roughness={0.95}
            clippingPlanes={clipPlanes}
          />
        </mesh>
      )}
      {railBridgeGeo && (
        <mesh geometry={railBridgeGeo} castShadow>
          <meshStandardMaterial
            color="#e0bf9a"
            map={tx.rail}
            roughness={0.95}
            clippingPlanes={clipPlanes}
          />
        </mesh>
      )}
      <RailCatenary world={world} terrain={terrain} />
      {apronGeo && (
        <mesh geometry={apronGeo} receiveShadow>
          <meshStandardMaterial color="#a7adb4" roughness={0.9} clippingPlanes={clipPlanes} />
        </mesh>
      )}
      {taxiwayGeo && (
        <mesh geometry={taxiwayGeo} receiveShadow>
          <meshStandardMaterial color="#8f959c" roughness={0.92} clippingPlanes={clipPlanes} />
        </mesh>
      )}
      {runwayGeo && (
        <mesh geometry={runwayGeo} receiveShadow>
          <meshStandardMaterial
            color="#c9ccd2"
            map={tx.runway}
            roughness={0.92}
            clippingPlanes={clipPlanes}
          />
        </mesh>
      )}
      {bridgeDeckGeo && (
        <mesh geometry={bridgeDeckGeo} castShadow>
          <meshStandardMaterial color="#9a9183" roughness={0.9} clippingPlanes={clipPlanes} />
        </mesh>
      )}
      {bridgeGeo && (
        <mesh geometry={bridgeGeo} castShadow>
          <meshStandardMaterial
            color={roadLine}
            map={tx.asphalt}
            roughness={0.92}
            clippingPlanes={clipPlanes}
          />
        </mesh>
      )}

      {city.wall && (
        <mesh geometry={city.wall} castShadow receiveShadow>
          <meshStandardMaterial
            vertexColors
            map={tx.windowDay}
            emissiveMap={tx.windowNight}
            emissive={isDay ? '#000000' : '#ffbe6a'}
            emissiveIntensity={isDay ? 0 : 1}
            roughness={0.85}
            clippingPlanes={clipPlanes}
            onBeforeCompile={patchBuildMaterial}
            customProgramCacheKey={buildCacheKey}
          />
        </mesh>
      )}
      {city.roof && (
        <mesh geometry={city.roof} castShadow receiveShadow>
          <meshStandardMaterial
            vertexColors
            roughness={0.9}
            clippingPlanes={clipPlanes}
            onBeforeCompile={patchBuildMaterial}
            customProgramCacheKey={buildCacheKey}
          />
        </mesh>
      )}

      <Trees spots={treeSpots} theme={theme} terrain={terrain} />
    </group>
  )
}
