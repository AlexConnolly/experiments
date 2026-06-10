import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Weather, WorldData } from '../lib/types'
import { HALF, WORLD_HALF, clipPlanes } from './Diorama'

function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

interface Route {
  pts: [number, number][]
  cum: number[]
  length: number
  /** wider roads carry proportionally more traffic */
  weight: number
  width: number
  bridge?: boolean
}

function buildRoutes(roads: WorldData['roads']): Route[] {
  const routes: Route[] = []
  for (const r of roads) {
    if (r.kind !== 'road' || r.width < 5) continue
    const cum = [0]
    for (let i = 1; i < r.path.length; i++) {
      const [ax, az] = r.path[i - 1]
      const [bx, bz] = r.path[i]
      cum.push(cum[i - 1] + Math.hypot(bx - ax, bz - az))
    }
    const length = cum[cum.length - 1]
    if (length >= 50)
      routes.push({
        pts: r.path,
        cum,
        length,
        weight: length * Math.pow(r.width / 5.5, 2),
        width: r.width,
        bridge: r.bridge,
      })
  }
  return routes
}

function pointAt(route: Route, s: number): { x: number; z: number; dx: number; dz: number } {
  const { pts, cum } = route
  let i = 1
  while (i < cum.length - 1 && cum[i] < s) i++
  const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
  const [ax, az] = pts[i - 1]
  const [bx, bz] = pts[i]
  const len = Math.hypot(bx - ax, bz - az) || 1
  return {
    x: ax + (bx - ax) * t,
    z: az + (bz - az) * t,
    dx: (bx - ax) / len,
    dz: (bz - az) / len,
  }
}

const CAR_COLORS = ['#e85d4a', '#4a90d9', '#f2c14e', '#7bb661', '#e8e6e1', '#9b7ec8', '#46555f']

/* ----------------------------------- cars ---------------------------------- */

type VehicleKind = 'car' | 'van' | 'bus'

const VAN_COLORS = ['#e8e6e1', '#d8d3c8', '#9aa0a8', '#c8d4dc']
const BUS_COLORS = ['#c8302a', '#d6492f', '#b03a3a']

interface Vehicle {
  route: number
  dir: number
  offset: number
  speed: number
  color: THREE.Color
  kind: VehicleKind
  /** index within its kind's InstancedMesh */
  slot: number
  halfLen: number
}

export function Cars({ world, isDay }: { world: WorldData; isDay: boolean }) {
  const meshes = useRef<Record<VehicleKind, THREE.InstancedMesh | null>>({
    car: null,
    van: null,
    bus: null,
  })
  const cabin = useRef<THREE.InstancedMesh>(null)
  const heads = useRef<THREE.InstancedMesh>(null)
  const tails = useRef<THREE.InstancedMesh>(null)
  const routes = useMemo(() => buildRoutes(world.roads), [world])

  const fleet = useMemo(() => {
    if (!routes.length)
      return { vehicles: [] as Vehicle[], counts: { car: 0, van: 0, bus: 0 } }
    const totalWeight = routes.reduce((a, r) => a + r.weight, 0)
    // a capital should feel busy: lots of traffic, weighted onto big roads
    const n = Math.round(THREE.MathUtils.clamp(totalWeight / 9, 60, 800))
    const counts = { car: 0, van: 0, bus: 0 }
    const vehicles = Array.from({ length: n }, (_, i): Vehicle => {
      let target = rand(i * 17.3) * totalWeight
      let route = 0
      while (route < routes.length - 1 && target > routes[route].weight) {
        target -= routes[route].weight
        route++
      }
      const roll = rand(i * 51.7)
      const kind: VehicleKind =
        roll < 0.1 && routes[route].width >= 6.5 ? 'bus' : roll < 0.3 ? 'van' : 'car'
      const palette =
        kind === 'bus' ? BUS_COLORS : kind === 'van' ? VAN_COLORS : CAR_COLORS
      return {
        route,
        dir: rand(i * 31.1) > 0.5 ? 1 : -1,
        offset: rand(i * 7.9) * 1000,
        speed: (kind === 'bus' ? 5 : 6) + rand(i * 13.7) * 6,
        color: new THREE.Color(palette[Math.floor(rand(i * 71.3) * palette.length)]),
        kind,
        slot: counts[kind]++,
        halfLen: kind === 'bus' ? 5.2 : kind === 'van' ? 2.8 : 2.5,
      }
    })
    return { vehicles, counts }
  }, [routes])

  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      s: new THREE.Vector3(1, 1, 1),
      up: new THREE.Vector3(0, 1, 0),
    }),
    [],
  )

  useFrame(({ clock }) => {
    if (!routes.length || !meshes.current.car) return
    const t = clock.elapsedTime
    let carIdx = 0
    fleet.vehicles.forEach((v, i) => {
      const route = routes[v.route]
      let s = (v.offset + t * v.speed) % route.length
      if (v.dir < 0) s = route.length - s
      const { x, z, dx, dz } = pointAt(route, s)
      const fx = dx * v.dir
      const fz = dz * v.dir
      // keep to the left lane, gives two-way traffic on shared roads
      const px = x - fz * 1.4
      const pz = z + fx * 1.4
      // vehicles on a bridge way ride on its elevated deck
      const lift = route.bridge ? 2.8 : 0
      tmp.q.setFromAxisAngle(tmp.up, Math.atan2(fx, fz))

      tmp.p.set(px, (v.kind === 'bus' ? 1.6 : 0.95) + lift, pz)
      tmp.m.compose(tmp.p, tmp.q, tmp.s)
      meshes.current[v.kind]?.setMatrixAt(v.slot, tmp.m)

      if (v.kind === 'car') {
        tmp.p.set(px - fx * 0.55, 1.78 + lift, pz - fz * 0.55)
        tmp.m.compose(tmp.p, tmp.q, tmp.s)
        cabin.current?.setMatrixAt(carIdx, tmp.m)
        carIdx++
      }

      if (!isDay) {
        for (const side of [-1, 1]) {
          const ox = -fz * 0.62 * side
          const oz = fx * 0.62 * side
          const slot = i * 2 + (side + 1) / 2
          tmp.p.set(px + fx * v.halfLen + ox, 0.95 + lift, pz + fz * v.halfLen + oz)
          tmp.m.compose(tmp.p, tmp.q, tmp.s)
          heads.current?.setMatrixAt(slot, tmp.m)
          tmp.p.set(px - fx * v.halfLen + ox, 0.95 + lift, pz - fz * v.halfLen + oz)
          tmp.m.compose(tmp.p, tmp.q, tmp.s)
          tails.current?.setMatrixAt(slot, tmp.m)
        }
      }
    })
    for (const kind of ['car', 'van', 'bus'] as const) {
      const m = meshes.current[kind]
      if (m) m.instanceMatrix.needsUpdate = true
    }
    if (cabin.current) cabin.current.instanceMatrix.needsUpdate = true
    if (!isDay && heads.current && tails.current) {
      heads.current.instanceMatrix.needsUpdate = true
      tails.current.instanceMatrix.needsUpdate = true
    }
  })

  const { vehicles, counts } = fleet
  if (!routes.length || !vehicles.length) return null

  const bindColors = (kind: VehicleKind) => (m: THREE.InstancedMesh | null) => {
    meshes.current[kind] = m
    if (m) {
      vehicles.filter((v) => v.kind === kind).forEach((v) => m.setColorAt(v.slot, v.color))
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }

  return (
    <>
      <instancedMesh
        key={`car${counts.car}`}
        ref={bindColors('car')}
        args={[undefined, undefined, Math.max(1, counts.car)]}
        castShadow
      >
        <boxGeometry args={[2.2, 1.5, 5.2]} />
        <meshStandardMaterial roughness={0.55} metalness={0.15} emissive="#16181f" clippingPlanes={clipPlanes} />
      </instancedMesh>
      <instancedMesh
        key={`van${counts.van}`}
        ref={bindColors('van')}
        args={[undefined, undefined, Math.max(1, counts.van)]}
        castShadow
      >
        <boxGeometry args={[2.3, 2.3, 6]} />
        <meshStandardMaterial roughness={0.6} metalness={0.1} emissive="#16181f" clippingPlanes={clipPlanes} />
      </instancedMesh>
      <instancedMesh
        key={`bus${counts.bus}`}
        ref={bindColors('bus')}
        args={[undefined, undefined, Math.max(1, counts.bus)]}
        castShadow
      >
        <boxGeometry args={[2.6, 3.2, 10.5]} />
        <meshStandardMaterial roughness={0.5} metalness={0.1} emissive="#1f1416" clippingPlanes={clipPlanes} />
      </instancedMesh>
      <instancedMesh
        key={`cabin${counts.car}`}
        ref={cabin}
        args={[undefined, undefined, Math.max(1, counts.car)]}
      >
        <boxGeometry args={[1.95, 0.95, 2.6]} />
        <meshStandardMaterial
          color="#3d4754"
          roughness={0.3}
          metalness={0.35}
          emissive={isDay ? '#000000' : '#2a3140'}
          clippingPlanes={clipPlanes}
        />
      </instancedMesh>
      {!isDay && (
        <>
          <instancedMesh
            key={`heads${vehicles.length}`}
            ref={heads}
            args={[undefined, undefined, vehicles.length * 2]}
          >
            <sphereGeometry args={[0.28, 6, 6]} />
            <meshBasicMaterial color="#ffeebb" clippingPlanes={clipPlanes} />
          </instancedMesh>
          <instancedMesh
            key={`tails${vehicles.length}`}
            ref={tails}
            args={[undefined, undefined, vehicles.length * 2]}
          >
            <sphereGeometry args={[0.22, 6, 6]} />
            <meshBasicMaterial color="#ff5448" clippingPlanes={clipPlanes} />
          </instancedMesh>
        </>
      )}
    </>
  )
}

/* -------------------------------- parked cars ------------------------------- */

const PARKED_COLORS = ['#aeb4ba', '#8a9097', '#c2bcae', '#7e8a96', '#b0a8a0', '#5e6870', '#c9cdd2']

export function ParkedCars({ world }: { world: WorldData }) {
  const { matrices, colors } = useMemo(() => {
    const matrices: THREE.Matrix4[] = []
    const colors: THREE.Color[] = []
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const sc = new THREE.Vector3(1, 1, 1)
    const up = new THREE.Vector3(0, 1, 0)
    let seed = 0
    for (const r of world.roads) {
      if (r.kind !== 'road' || r.bridge || r.width < 5 || r.width > 8) continue
      const cum = [0]
      for (let i = 1; i < r.path.length; i++) {
        const [ax, az] = r.path[i - 1]
        const [bx, bz] = r.path[i]
        cum.push(cum[i - 1] + Math.hypot(bx - ax, bz - az))
      }
      const route: Route = { pts: r.path, cum, length: cum[cum.length - 1], weight: 0, width: r.width }
      let side = 1
      for (let s = 8; s < route.length - 6; s += 11) {
        seed++
        side = -side
        if (rand(seed * 13.7) > 0.72) continue
        const { x, z, dx, dz } = pointAt(route, s)
        const ox = -dz * (r.width / 2 + 1.15) * side
        const oz = dx * (r.width / 2 + 1.15) * side
        const px = x + ox
        const pz = z + oz
        if (Math.abs(px) > WORLD_HALF - 2 || Math.abs(pz) > WORLD_HALF - 2) continue
        q.setFromAxisAngle(up, Math.atan2(dx, dz) + (rand(seed * 3.1) - 0.5) * 0.06)
        p.set(px, 0.85, pz)
        matrices.push(new THREE.Matrix4().compose(p, q, sc))
        colors.push(
          new THREE.Color(PARKED_COLORS[Math.floor(rand(seed * 7.9) * PARKED_COLORS.length)]),
        )
        if (matrices.length >= 800) break
      }
      if (matrices.length >= 800) break
    }
    return { matrices, colors }
  }, [world])

  if (!matrices.length) return null
  return (
    <instancedMesh
      key={`parked${matrices.length}`}
      ref={(m) => {
        if (!m) return
        matrices.forEach((mat, i) => {
          m.setMatrixAt(i, mat)
          m.setColorAt(i, colors[i])
        })
        m.instanceMatrix.needsUpdate = true
        if (m.instanceColor) m.instanceColor.needsUpdate = true
      }}
      args={[undefined, undefined, matrices.length]}
      castShadow
    >
      <boxGeometry args={[1.9, 1.35, 4.6]} />
      <meshStandardMaterial roughness={0.65} metalness={0.1} clippingPlanes={clipPlanes} />
    </instancedMesh>
  )
}

/* ------------------------------- pedestrians -------------------------------- */

const CLOTHES = ['#d96459', '#5a87c5', '#e8b84f', '#6aa86a', '#b07ec9', '#e8e2d8', '#46555f', '#d98ca0']

export function Pedestrians({ world, isDay }: { world: WorldData; isDay: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const routes = useMemo(() => {
    const out: Route[] = []
    for (const r of world.roads) {
      if (r.kind !== 'path') continue
      const cum = [0]
      for (let i = 1; i < r.path.length; i++) {
        const [ax, az] = r.path[i - 1]
        const [bx, bz] = r.path[i]
        cum.push(cum[i - 1] + Math.hypot(bx - ax, bz - az))
      }
      const length = cum[cum.length - 1]
      if (length >= 40)
        out.push({
          pts: r.path,
          cum,
          length,
          weight: length,
          width: r.width,
          bridge: r.bridge,
        })
    }
    return out
  }, [world])

  const walkers = useMemo(() => {
    if (!routes.length) return []
    const totalWeight = routes.reduce((a, r) => a + r.weight, 0)
    const n = Math.round(
      THREE.MathUtils.clamp(totalWeight / 220, 8, 60) * (isDay ? 1 : 0.3),
    )
    return Array.from({ length: n }, (_, i) => {
      let target = rand(i * 23.7) * totalWeight
      let route = 0
      while (route < routes.length - 1 && target > routes[route].weight) {
        target -= routes[route].weight
        route++
      }
      return {
        route,
        dir: rand(i * 9.1) > 0.5 ? 1 : -1,
        offset: rand(i * 5.3) * 800,
        speed: 0.9 + rand(i * 11.9) * 0.7,
        side: (rand(i * 15.1) - 0.5) * 1.2,
        bob: rand(i * 19.3) * Math.PI * 2,
        color: new THREE.Color(CLOTHES[i % CLOTHES.length]),
      }
    })
  }, [routes, isDay])

  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      s: new THREE.Vector3(1, 1, 1),
      up: new THREE.Vector3(0, 1, 0),
    }),
    [],
  )

  useFrame(({ clock }) => {
    if (!mesh.current || !routes.length) return
    const t = clock.elapsedTime
    walkers.forEach((w, i) => {
      const route = routes[w.route]
      let s = (w.offset + t * w.speed) % route.length
      if (w.dir < 0) s = route.length - s
      const { x, z, dx, dz } = pointAt(route, s)
      tmp.p.set(
        x - dz * w.side,
        0.95 + (route.bridge ? 2.8 : 0) + Math.abs(Math.sin(t * 4.5 + w.bob)) * 0.12,
        z + dx * w.side,
      )
      tmp.q.setFromAxisAngle(tmp.up, Math.atan2(dx * w.dir, dz * w.dir))
      tmp.m.compose(tmp.p, tmp.q, tmp.s)
      mesh.current!.setMatrixAt(i, tmp.m)
    })
    mesh.current.instanceMatrix.needsUpdate = true
  })

  if (!walkers.length) return null
  return (
    <instancedMesh
      key={`walk${walkers.length}`}
      ref={(m) => {
        mesh.current = m
        if (m) {
          walkers.forEach((w, i) => m.setColorAt(i, w.color))
          if (m.instanceColor) m.instanceColor.needsUpdate = true
        }
      }}
      args={[undefined, undefined, walkers.length]}
      castShadow
    >
      <capsuleGeometry args={[0.38, 0.85, 3, 8]} />
      <meshStandardMaterial roughness={0.9} clippingPlanes={clipPlanes} />
    </instancedMesh>
  )
}

/* ----------------------------------- boats ---------------------------------- */

const BOAT_COLORS = ['#3f6f4f', '#7c4a3d', '#3d5a7c', '#8a3f4d']

export function Boats({ world }: { world: WorldData }) {
  const group = useRef<THREE.Group>(null)
  const routes = useMemo(() => {
    const out: Route[] = []
    for (const path of world.waterways) {
      const cum = [0]
      for (let i = 1; i < path.length; i++) {
        const [ax, az] = path[i - 1]
        const [bx, bz] = path[i]
        cum.push(cum[i - 1] + Math.hypot(bx - ax, bz - az))
      }
      const length = cum[cum.length - 1]
      if (length >= 120)
        out.push({ pts: path, cum, length, weight: length, width: 10 })
    }
    return out.slice(0, 5)
  }, [world])

  useFrame(({ clock }) => {
    if (!group.current) return
    const t = clock.elapsedTime
    group.current.children.forEach((boat, i) => {
      const route = routes[i]
      const speed = 2 + rand(i * 7.7) * 1.2
      let s = (rand(i * 3.1) * 500 + t * speed) % route.length
      if (i % 2 === 1) s = route.length - s
      const { x, z, dx, dz } = pointAt(route, s)
      const dir = i % 2 === 1 ? -1 : 1
      boat.position.set(x, 0.3 + Math.sin(t * 1.3 + i) * 0.06, z)
      boat.rotation.y = Math.atan2(dx * dir, dz * dir)
      boat.rotation.z = Math.sin(t * 1.1 + i * 2) * 0.02
    })
  })

  if (!routes.length) return null
  return (
    <group ref={group}>
      {routes.map((_, i) => (
        <group key={i}>
          <mesh castShadow>
            <boxGeometry args={[2.4, 1, 7.5]} />
            <meshStandardMaterial
              color={BOAT_COLORS[i % BOAT_COLORS.length]}
              roughness={0.7}
              clippingPlanes={clipPlanes}
            />
          </mesh>
          <mesh position={[0, 0.9, -0.8]}>
            <boxGeometry args={[1.8, 0.9, 3.6]} />
            <meshStandardMaterial color="#ece6d8" roughness={0.7} clippingPlanes={clipPlanes} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/* ---------------------------------- trains --------------------------------- */

const LIVERIES = ['#c8302a', '#2f5d9e', '#3f7a4a', '#d6762f']
const CARRIAGE_LEN = 15
const CARRIAGE_GAP = 1.5

export function Trains({ world }: { world: WorldData }) {
  const group = useRef<THREE.Group>(null)
  const routes = useMemo(() => {
    const out: Route[] = []
    for (const r of world.rails) {
      const cum = [0]
      for (let i = 1; i < r.path.length; i++) {
        const [ax, az] = r.path[i - 1]
        const [bx, bz] = r.path[i]
        cum.push(cum[i - 1] + Math.hypot(bx - ax, bz - az))
      }
      const length = cum[cum.length - 1]
      if (length >= 180)
        out.push({
          pts: r.path,
          cum,
          length,
          weight: length,
          width: 4,
          bridge: r.bridge,
        })
    }
    // longest lines carry the trains
    return out.sort((a, b) => b.length - a.length).slice(0, 4)
  }, [world])

  useFrame(({ clock }) => {
    if (!group.current) return
    const t = clock.elapsedTime
    group.current.children.forEach((train, ti) => {
      const route = routes[ti]
      const dir = ti % 2 === 0 ? 1 : -1
      const speed = 13 + rand(ti * 9.1) * 5
      const head = rand(ti * 3.7) * 600 + t * speed
      const lift = route.bridge ? 2.8 : 0
      train.children.forEach((carriage, ci) => {
        let s = (head - ci * (CARRIAGE_LEN + CARRIAGE_GAP)) % route.length
        s = ((s % route.length) + route.length) % route.length
        if (dir < 0) s = route.length - s
        const { x, z, dx, dz } = pointAt(route, s)
        carriage.position.set(x, 2 + lift, z)
        carriage.rotation.y = Math.atan2(dx * dir, dz * dir)
      })
    })
  })

  if (!routes.length) return null
  return (
    <group ref={group}>
      {routes.map((_, ti) => (
        <group key={ti}>
          {[0, 1, 2].map((ci) => (
            <group key={ci}>
              <mesh castShadow>
                <boxGeometry args={[3, 3.2, CARRIAGE_LEN]} />
                <meshStandardMaterial
                  color={ci === 0 ? LIVERIES[ti % LIVERIES.length] : '#e8e5de'}
                  roughness={0.45}
                  metalness={0.15}
                  clippingPlanes={clipPlanes}
                />
              </mesh>
              <mesh position={[0, 1.75, 0]}>
                <boxGeometry args={[2.6, 0.4, CARRIAGE_LEN - 1.5]} />
                <meshStandardMaterial color="#5a5f66" roughness={0.6} clippingPlanes={clipPlanes} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  )
}

/* --------------------------------- balloon ---------------------------------- */

export function Balloon({ weather }: { weather: Weather }) {
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!group.current) return
    const t = clock.elapsedTime
    const a = t * 0.014
    group.current.position.set(
      Math.cos(a) * 380,
      168 + Math.sin(t * 0.25) * 9,
      Math.sin(a) * 380,
    )
  })
  const calm = weather.condition === 'clear' || weather.condition === 'partly'
  if (!weather.isDay || !calm) return null
  return (
    <group ref={group}>
      <mesh castShadow>
        <sphereGeometry args={[12, 16, 16]} />
        <meshStandardMaterial color="#e85d4a" roughness={0.6} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[11.2, 1.6, 8, 24]} />
        <meshStandardMaterial color="#f2e3cf" roughness={0.6} />
      </mesh>
      <mesh position={[0, -10, 0]}>
        <cylinderGeometry args={[2.5, 6, 7, 8, 1, true]} />
        <meshStandardMaterial color="#d8d3c8" roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -16, 0]}>
        <boxGeometry args={[3.4, 3, 3.4]} />
        <meshStandardMaterial color="#8a6a4f" roughness={0.9} />
      </mesh>
    </group>
  )
}

/* ---------------------------------- birds ---------------------------------- */

function Flock({ radius, height, phase, speed }: { radius: number; height: number; phase: number; speed: number }) {
  const group = useRef<THREE.Group>(null)
  const birds = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const row = Math.ceil(i / 2)
        const side = i % 2 === 1 ? 1 : -1
        return { lateral: row * 3.2 * side, back: row * 4, bob: rand(i * 5.7) * Math.PI * 2 }
      }),
    [],
  )

  useFrame(({ clock }) => {
    if (!group.current) return
    const t = clock.elapsedTime
    const a = phase + t * speed
    const cx = Math.cos(a) * radius
    const cz = Math.sin(a) * radius
    const dirX = -Math.sin(a)
    const dirZ = Math.cos(a)
    group.current.children.forEach((bird, i) => {
      const b = birds[i]
      const rx = dirZ
      const rz = -dirX
      bird.position.set(
        cx - dirX * b.back + rx * b.lateral,
        height + Math.sin(t * 7 + b.bob) * 1.2 + Math.sin(t * 0.4 + phase) * 5,
        cz - dirZ * b.back + rz * b.lateral,
      )
      bird.rotation.y = Math.atan2(dirX, dirZ)
    })
  })

  return (
    <group ref={group}>
      {birds.map((_, i) => (
        <mesh key={i} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.9, 2.6, 4]} />
          <meshStandardMaterial color="#2e3540" roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

export function Birds({ weather }: { weather: Weather }) {
  const calm =
    weather.condition === 'clear' ||
    weather.condition === 'partly' ||
    weather.condition === 'cloudy'
  if (!weather.isDay || !calm) return null
  return (
    <>
      <Flock radius={185} height={68} phase={0} speed={0.05} />
      <Flock radius={320} height={95} phase={2.6} speed={-0.035} />
    </>
  )
}

/* -------------------------------- streetlamps ------------------------------- */

export function Streetlamps({ world, isDay }: { world: WorldData; isDay: boolean }) {
  const spots = useMemo(() => {
    const out: { x: number; z: number }[] = []
    for (const r of world.roads) {
      if (r.kind !== 'road' || r.width < 5) continue
      const cum = [0]
      for (let i = 1; i < r.path.length; i++) {
        const [ax, az] = r.path[i - 1]
        const [bx, bz] = r.path[i]
        cum.push(cum[i - 1] + Math.hypot(bx - ax, bz - az))
      }
      const route: Route = {
        pts: r.path,
        cum,
        length: cum[cum.length - 1],
        weight: 0,
        width: r.width,
      }
      let side = 1
      for (let s = 35; s < route.length; s += 75) {
        const { x, z, dx, dz } = pointAt(route, s)
        const ox = -dz * (r.width / 2 + 1.2) * side
        const oz = dx * (r.width / 2 + 1.2) * side
        side = -side
        if (Math.abs(x + ox) < WORLD_HALF - 2 && Math.abs(z + oz) < WORLD_HALF - 2)
          out.push({ x: x + ox, z: z + oz })
        if (out.length >= 160) return out
      }
    }
    return out
  }, [world])

  const matrices = useMemo(() => {
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3(1, 1, 1)
    return {
      poles: spots.map(({ x, z }) =>
        new THREE.Matrix4().compose(new THREE.Vector3(x, 2.6, z), q, s),
      ),
      bulbs: spots.map(({ x, z }) =>
        new THREE.Matrix4().compose(new THREE.Vector3(x, 5.4, z), q, s),
      ),
    }
  }, [spots])

  if (isDay || !spots.length) return null
  return (
    <>
      <instancedMesh
        key={`p${spots.length}`}
        args={[undefined, undefined, spots.length]}
        ref={(m) => {
          if (!m) return
          matrices.poles.forEach((mat, i) => m.setMatrixAt(i, mat))
          m.instanceMatrix.needsUpdate = true
        }}
      >
        <cylinderGeometry args={[0.14, 0.18, 5.2, 5]} />
        <meshStandardMaterial color="#3a4049" roughness={0.8} clippingPlanes={clipPlanes} />
      </instancedMesh>
      <instancedMesh
        key={`b${spots.length}`}
        args={[undefined, undefined, spots.length]}
        ref={(m) => {
          if (!m) return
          matrices.bulbs.forEach((mat, i) => m.setMatrixAt(i, mat))
          m.instanceMatrix.needsUpdate = true
        }}
      >
        <sphereGeometry args={[0.65, 8, 8]} />
        <meshBasicMaterial color="#ffd9a3" clippingPlanes={clipPlanes} />
      </instancedMesh>
    </>
  )
}

/* ---------------------------------- smoke ----------------------------------- */

function Chimney({ x, z, top, seed }: { x: number; z: number; top: number; seed: number }) {
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!group.current) return
    const t = clock.elapsedTime
    group.current.children.forEach((puff, i) => {
      const p = (t * 0.13 + i / 4 + seed) % 1
      puff.position.set(x + p * 6 + Math.sin(t * 0.5 + i) * 1.5, top + 2 + p * 24, z)
      const s = 1.4 + p * 3.4
      puff.scale.setScalar(s)
      const mat = (puff as THREE.Mesh).material as THREE.MeshStandardMaterial
      mat.opacity = 0.38 * (1 - p)
    })
  })
  return (
    <group ref={group}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i}>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial
            color="#e6e7ec"
            transparent
            opacity={0}
            depthWrite={false}
            roughness={1}
            flatShading
          />
        </mesh>
      ))}
    </group>
  )
}

export function Smoke({ world, weather }: { world: WorldData; weather: Weather }) {
  const chimneys = useMemo(() => {
    const candidates = world.buildings
      .map((b) => {
        let x = 0
        let z = 0
        for (const [px, pz] of b.footprint) {
          x += px
          z += pz
        }
        x /= b.footprint.length
        z /= b.footprint.length
        return { x, z, top: b.height }
      })
      .filter((c) => Math.abs(c.x) < HALF - 20 && Math.abs(c.z) < HALF - 20)
      .sort((a, b) => b.top - a.top)
    return candidates.slice(0, 3)
  }, [world])

  const cold = weather.temperature < 10
  const raining =
    weather.condition === 'rain' || weather.condition === 'thunder'
  if (!cold || raining) return null
  return (
    <>
      {chimneys.map((c, i) => (
        <Chimney key={i} x={c.x} z={c.z} top={c.top} seed={i * 0.37} />
      ))}
    </>
  )
}
