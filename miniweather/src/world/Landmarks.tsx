import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Coords } from '../lib/types'
import type { Terrain } from '../lib/terrain'
import { LANDMARKS, type LandmarkKind } from '../lib/cities'
import { WORLD_HALF, clipPlanes } from './Diorama'
import { buildUniform, easeOutBack } from './buildAnim'

/** Scale-in like the buildings: rises a moment after the centre tile. */
function Rise({ delay, children }: { delay: number; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!group.current) return
    const t = THREE.MathUtils.clamp((buildUniform.value - delay) / 1.1, 0, 1)
    group.current.scale.y = Math.max(0.001, easeOutBack(t))
  })
  return <group ref={group}>{children}</group>
}

const steel = <meshStandardMaterial color="#dfe3e8" roughness={0.4} metalness={0.4} clippingPlanes={clipPlanes} />

function Wheel() {
  const wheel = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (wheel.current) wheel.current.rotation.z += dt * 0.06
  })
  const R = 58
  return (
    <group rotation={[0, -Math.PI / 5, 0]}>
      {/* A-frame legs */}
      <mesh position={[0, 33, 6]} rotation={[0.18, 0, 0]} castShadow>
        <cylinderGeometry args={[1.6, 2.4, 68, 8]} />
        {steel}
      </mesh>
      <mesh position={[0, 33, -6]} rotation={[-0.18, 0, 0]} castShadow>
        <cylinderGeometry args={[1.6, 2.4, 68, 8]} />
        {steel}
      </mesh>
      <group ref={wheel} position={[0, 66, 0]}>
        <mesh castShadow>
          <torusGeometry args={[R, 1.6, 8, 56]} />
          {steel}
        </mesh>
        <mesh>
          <torusGeometry args={[R - 6, 0.7, 6, 56]} />
          {steel}
        </mesh>
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2
          return (
            <group key={i}>
              <mesh position={[Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 0]} rotation={[0, 0, a + Math.PI / 2]}>
                <cylinderGeometry args={[0.45, 0.45, R, 5]} />
                {steel}
              </mesh>
              {i % 2 === 0 && (
                <mesh position={[Math.cos(a) * R, Math.sin(a) * R, 0]}>
                  <capsuleGeometry args={[2.1, 2.6, 4, 10]} />
                  <meshStandardMaterial color="#3e4c5c" roughness={0.25} metalness={0.3} clippingPlanes={clipPlanes} />
                </mesh>
              )}
            </group>
          )
        })}
        <mesh>
          <sphereGeometry args={[2.6, 12, 12]} />
          {steel}
        </mesh>
      </group>
    </group>
  )
}

function LatticeTower({ body, accents }: { body: string; accents: string }) {
  const mat = <meshStandardMaterial color={body} roughness={0.65} metalness={0.25} flatShading clippingPlanes={clipPlanes} />
  const deck = <meshStandardMaterial color={accents} roughness={0.6} clippingPlanes={clipPlanes} />
  return (
    <group rotation={[0, Math.PI / 4, 0]}>
      <mesh position={[0, 29, 0]} castShadow>
        <cylinderGeometry args={[15, 27, 58, 4]} />
        {mat}
      </mesh>
      <mesh position={[0, 59, 0]} castShadow>
        <boxGeometry args={[34, 4, 34]} />
        {deck}
      </mesh>
      <mesh position={[0, 89, 0]} castShadow>
        <cylinderGeometry args={[7.5, 14.5, 56, 4]} />
        {mat}
      </mesh>
      <mesh position={[0, 118, 0]}>
        <boxGeometry args={[18, 3.5, 18]} />
        {deck}
      </mesh>
      <mesh position={[0, 160, 0]} castShadow>
        <cylinderGeometry args={[1.6, 7, 82, 4]} />
        {mat}
      </mesh>
      <mesh position={[0, 209, 0]}>
        <cylinderGeometry args={[0.5, 0.9, 16, 5]} />
        {deck}
      </mesh>
    </group>
  )
}

function Campanile() {
  return (
    <group>
      <mesh position={[0, 30, 0]} castShadow>
        <boxGeometry args={[11, 60, 11]} />
        <meshStandardMaterial color="#b3573f" roughness={0.85} clippingPlanes={clipPlanes} />
      </mesh>
      <mesh position={[0, 64, 0]} castShadow>
        <boxGeometry args={[12.5, 9, 12.5]} />
        <meshStandardMaterial color="#ece6d8" roughness={0.8} clippingPlanes={clipPlanes} />
      </mesh>
      <mesh position={[0, 75, 0]} castShadow>
        <cylinderGeometry args={[0.2, 8.4, 13, 4]} />
        <meshStandardMaterial color="#4e7a5a" roughness={0.7} flatShading clippingPlanes={clipPlanes} />
      </mesh>
    </group>
  )
}

function BigBen() {
  const clock = (rot: [number, number, number], pos: [number, number, number]) => (
    <mesh position={pos} rotation={rot}>
      <circleGeometry args={[4.2, 20]} />
      <meshStandardMaterial color="#f4ecd8" roughness={0.5} emissive="#c8b87a" emissiveIntensity={0.25} clippingPlanes={clipPlanes} />
    </mesh>
  )
  return (
    <group>
      <mesh position={[0, 31, 0]} castShadow>
        <boxGeometry args={[11.5, 62, 11.5]} />
        <meshStandardMaterial color="#c9b98c" roughness={0.85} clippingPlanes={clipPlanes} />
      </mesh>
      <mesh position={[0, 66, 0]} castShadow>
        <boxGeometry args={[13, 10, 13]} />
        <meshStandardMaterial color="#bca87a" roughness={0.85} clippingPlanes={clipPlanes} />
      </mesh>
      {clock([0, 0, 0], [0, 66, 6.6])}
      {clock([0, Math.PI, 0], [0, 66, -6.6])}
      {clock([0, Math.PI / 2, 0], [6.6, 66, 0])}
      {clock([0, -Math.PI / 2, 0], [-6.6, 66, 0])}
      <mesh position={[0, 78, 0]} castShadow>
        <cylinderGeometry args={[0.3, 7.2, 14, 4]} />
        <meshStandardMaterial color="#5a5648" roughness={0.7} flatShading clippingPlanes={clipPlanes} />
      </mesh>
    </group>
  )
}

const MODELS: Record<LandmarkKind, () => React.ReactNode> = {
  wheel: () => <Wheel />,
  eiffel: () => <LatticeTower body="#7d5638" accents="#9a7350" />,
  'tower-red': () => <LatticeTower body="#d6492f" accents="#f0ece4" />,
  campanile: () => <Campanile />,
  bigben: () => <BigBen />,
}

/** Radius (m) around each landmark kept clear of OSM building extrusions. */
const CLEAR_RADIUS: Record<LandmarkKind, number> = {
  wheel: 85,
  eiffel: 95,
  'tower-red': 85,
  campanile: 28,
  bigben: 35,
}

export interface PlacedLandmark {
  kind: LandmarkKind
  x: number
  z: number
  clearRadius: number
}

export function placeLandmarks(coords: Coords): PlacedLandmark[] {
  const mPerLon = 111_320 * Math.cos((coords.lat * Math.PI) / 180)
  return LANDMARKS.map((lm) => ({
    kind: lm.kind,
    x: (lm.lon - coords.lon) * mPerLon,
    z: -(lm.lat - coords.lat) * 110_540,
    clearRadius: CLEAR_RADIUS[lm.kind],
  })).filter((p) => Math.abs(p.x) < WORLD_HALF - 15 && Math.abs(p.z) < WORLD_HALF - 15)
}

export function Landmarks({
  placed,
  terrain,
}: {
  placed: PlacedLandmark[]
  terrain: Terrain
}) {
  return (
    <>
      {placed.map((p, i) => (
        <group key={`${p.kind}${i}`} position={[p.x, terrain.h(p.x, p.z), p.z]}>
          <Rise delay={0.5 + i * 0.25}>{MODELS[p.kind]()}</Rise>
        </group>
      ))}
    </>
  )
}
