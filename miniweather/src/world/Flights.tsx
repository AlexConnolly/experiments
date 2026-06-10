import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Coords } from '../lib/types'
import type { Terrain } from '../lib/terrain'

/**
 * Real aircraft currently overhead, via the free keyless adsb.lol API
 * (OpenSky as fallback). Positions are scaled down onto the diorama sky and
 * dead-reckoned along each plane's real track between refreshes.
 */

/** Horizontal metres of real world per metre of diorama sky. */
const SCALE = 15
const REFRESH_MS = 25_000
const MAX_PLANES = 7

/**
 * Relative altitude: square-root compression keeps cruise traffic high while
 * approach/landing traffic visibly descends toward the rooftops.
 */
function skyHeight(altM: number): number {
  // base 6 ≈ wheel height of the toy-scaled model, so grounded planes sit down
  return Math.min(6 + Math.sqrt(Math.max(altM, 0)) * 2.3, 290)
}

interface Plane {
  id: string
  x: number
  z: number
  /** real altitude in metres, dead-reckoned via vRate between polls */
  altM: number
  /** real climb/descent rate in m/s */
  vRate: number
  heading: number
  /** scaled m/s across the diorama */
  speed: number
  tail: string
}

const TAILS = ['#d6492f', '#3d5a7c', '#e8b84f', '#3f6f4f', '#7c4ac9']

async function fetchAdsbStyle(url: string, coords: Coords): Promise<Plane[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`adsb ${res.status}`)
  const data = await res.json()
  const mPerLon = 111_320 * Math.cos((coords.lat * Math.PI) / 180)
  return ((data.ac ?? []) as Record<string, unknown>[])
    .filter(
      (a) =>
        typeof a.lat === 'number' &&
        typeof a.lon === 'number' &&
        typeof a.alt_baro === 'number' &&
        (a.alt_baro as number) > 80 && // airborne, including final approach
        typeof a.gs === 'number' &&
        (a.gs as number) > 55,
    )
    .slice(0, MAX_PLANES)
    .map((a, i) => ({
      id: String(a.hex ?? i),
      x: (((a.lon as number) - coords.lon) * mPerLon) / SCALE,
      z: (-((a.lat as number) - coords.lat) * 110_540) / SCALE,
      altM: (a.alt_baro as number) * 0.3048,
      // baro_rate is ft/min
      vRate: typeof a.baro_rate === 'number' ? (a.baro_rate as number) * 0.00508 : 0,
      heading: (((a.track as number) ?? 0) * Math.PI) / 180,
      speed: ((a.gs as number) * 0.514) / SCALE,
      tail: TAILS[parseInt(String(a.hex ?? '0'), 16) % TAILS.length],
    }))
}

async function fetchOpenSky(coords: Coords): Promise<Plane[]> {
  const d = 0.18
  const res = await fetch(
    `https://opensky-network.org/api/states/all?lamin=${coords.lat - d}&lomin=${coords.lon - d}&lamax=${coords.lat + d}&lomax=${coords.lon + d}`,
    { signal: AbortSignal.timeout(10_000) },
  )
  if (!res.ok) throw new Error(`opensky ${res.status}`)
  const data = await res.json()
  const mPerLon = 111_320 * Math.cos((coords.lat * Math.PI) / 180)
  return ((data.states ?? []) as (string | number | boolean | null)[][])
    .filter((s) => !s[8] && typeof s[5] === 'number' && typeof s[7] === 'number')
    .slice(0, MAX_PLANES)
    .map((s) => ({
      id: String(s[0]),
      x: (((s[5] as number) - coords.lon) * mPerLon) / SCALE,
      z: (-((s[6] as number) - coords.lat) * 110_540) / SCALE,
      altM: s[7] as number,
      vRate: typeof s[11] === 'number' ? (s[11] as number) : 0,
      heading: (((s[10] as number) ?? 0) * Math.PI) / 180,
      speed: (((s[9] as number) ?? 100) as number) / SCALE,
      tail: TAILS[parseInt(String(s[0]), 16) % TAILS.length],
    }))
}

function PlaneModel({ tail, night }: { tail: string; night: boolean }) {
  const strobe = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!strobe.current) return
    const blink = Math.sin(clock.elapsedTime * 7) > 0.75 ? 1 : 0.08
    ;(strobe.current.material as THREE.MeshBasicMaterial).opacity = blink
  })
  const body = night ? '#9aa6b8' : '#f2f4f7'
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <capsuleGeometry args={[1.1, 7, 4, 10]} />
        <meshStandardMaterial color={body} roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0.4]}>
        <boxGeometry args={[11, 0.28, 2.2]} />
        <meshStandardMaterial color={body} roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.9, -3.9]}>
        <boxGeometry args={[0.25, 2, 1.6]} />
        <meshStandardMaterial color={tail} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.2, -3.9]}>
        <boxGeometry args={[4, 0.22, 1.3]} />
        <meshStandardMaterial color={body} roughness={0.4} />
      </mesh>
      {night && (
        <mesh ref={strobe} position={[0, -0.6, 0]}>
          <sphereGeometry args={[0.5, 8, 8]} />
          <meshBasicMaterial color="#ff4040" transparent opacity={0.1} />
        </mesh>
      )}
    </group>
  )
}

export function Flights({
  coords,
  isDay,
  terrain,
}: {
  coords: Coords
  isDay: boolean
  terrain: Terrain
}) {
  const [planes, setPlanes] = useState<Plane[]>([])
  const refs = useRef<Map<string, THREE.Group>>(new Map())
  const lastAlt = useRef<Map<string, { alt: number; t: number }>>(new Map())

  useEffect(() => {
    let alive = true
    const load = async () => {
      const sources = [
        () =>
          fetchAdsbStyle(
            `https://api.adsb.lol/v2/lat/${coords.lat}/lon/${coords.lon}/dist/12`,
            coords,
          ),
        () =>
          fetchAdsbStyle(
            `https://api.airplanes.live/v2/point/${coords.lat}/${coords.lon}/12`,
            coords,
          ),
        () => fetchOpenSky(coords),
      ]
      for (const source of sources) {
        try {
          const p = await source()
          // glide-slope fallback: if the feed omits a climb rate, derive it
          // from the altitude change since the previous poll
          const now = Date.now()
          for (const plane of p) {
            const prev = lastAlt.current.get(plane.id)
            if (
              plane.vRate === 0 &&
              prev &&
              now - prev.t > 5_000 &&
              now - prev.t < 90_000
            ) {
              plane.vRate = (plane.altM - prev.alt) / ((now - prev.t) / 1000)
            }
            lastAlt.current.set(plane.id, { alt: plane.altM, t: now })
          }
          if (alive) setPlanes(p)
          return
        } catch {
          /* try the next provider */
        }
      }
    }
    void load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [coords])

  useFrame((_, dt) => {
    for (const p of planes) {
      p.x += Math.sin(p.heading) * p.speed * dt
      p.z += -Math.cos(p.heading) * p.speed * dt
      // apply the live climb/descent rate; a landed plane stays on the ground
      p.altM += p.vRate * dt
      if (p.altM <= 0) {
        p.altM = 0
        p.vRate = 0
        p.speed = Math.max(0, p.speed - dt * 0.4) // rollout
      }
      const g = refs.current.get(p.id)
      if (g) {
        // never sink below the local ground, even over hills
        const floor =
          Math.abs(p.x) < 690 && Math.abs(p.z) < 690 ? terrain.h(p.x, p.z) + 6 : 6
        g.position.set(p.x, Math.max(skyHeight(p.altM), floor), p.z)
        // model nose points +z; travel dir is (sin h, -cos h)
        g.rotation.y = Math.atan2(Math.sin(p.heading), -Math.cos(p.heading))
        // visible pitch when climbing or descending
        g.rotation.x = THREE.MathUtils.clamp(-p.vRate * 0.04, -0.3, 0.3)
      }
    }
  })

  return (
    <>
      {planes.map((p) => (
        <group
          key={p.id}
          position={[p.x, skyHeight(p.altM), p.z]}
          rotation={[0, Math.atan2(Math.sin(p.heading), -Math.cos(p.heading)), 0]}
          ref={(g) => {
            if (g) refs.current.set(p.id, g)
            else refs.current.delete(p.id)
          }}
        >
          {/* toy-scaled way up so planes read clearly from orbit height */}
          <group scale={5.5}>
            <PlaneModel tail={p.tail} night={!isDay} />
          </group>
        </group>
      ))}
    </>
  )
}
