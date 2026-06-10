import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, TiltShift2 } from '@react-three/postprocessing'
import type { Coords, Weather, WorldData } from '../lib/types'
import type { Terrain } from '../lib/terrain'
import { themeFor } from '../lib/theme'
import { sunPosition } from '../lib/astro'
import { Diorama } from './Diorama'
import { Clouds, Lightning, Rain, SkyDome, Snow } from './Effects'
import {
  Balloon,
  Birds,
  Boats,
  Cars,
  ParkedCars,
  Pedestrians,
  Smoke,
  Streetlamps,
  Trains,
} from './Life'
import { Flights } from './Flights'
import { Landmarks, placeLandmarks } from './Landmarks'
import { buildUniform, resetBuild } from './buildAnim'

// far enough out that no corner of the 3x3 grid falls behind the near plane
const ORBIT_RADIUS = 980
const ORBIT_HEIGHT = 650

/**
 * The camera orbits the diorama (drag to spin, wheel/pinch to zoom) while the
 * world and its lighting stay put — so shadows and sun direction stay honest.
 */
function OrbitRig() {
  const { camera, size, gl } = useThree()
  const state = useRef({
    azimuth: Math.PI / 4,
    velocity: 0,
    zoom: 1,
    dragging: false,
    lastX: 0,
    pointers: new Map<number, { x: number; y: number }>(),
    pinchDist: 0,
  })

  useEffect(() => {
    const el = gl.domElement
    const s = state.current

    const down = (e: PointerEvent) => {
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (s.pointers.size === 1) {
        s.dragging = true
        s.lastX = e.clientX
        s.velocity = 0
      } else if (s.pointers.size === 2) {
        s.dragging = false
        const [a, b] = [...s.pointers.values()]
        s.pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
    }
    const move = (e: PointerEvent) => {
      if (!s.pointers.has(e.pointerId)) return
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (s.pinchDist > 0) {
          s.zoom = THREE.MathUtils.clamp(s.zoom * (d / s.pinchDist), 0.5, 2.8)
        }
        s.pinchDist = d
      } else if (s.dragging) {
        const dx = e.clientX - s.lastX
        s.lastX = e.clientX
        s.velocity = -dx * 0.005
        s.azimuth -= dx * 0.005
      }
    }
    const up = (e: PointerEvent) => {
      s.pointers.delete(e.pointerId)
      if (s.pointers.size < 2) s.pinchDist = 0
      if (s.pointers.size === 0) s.dragging = false
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      s.zoom = THREE.MathUtils.clamp(s.zoom * Math.exp(-e.deltaY * 0.0012), 0.5, 2.8)
    }

    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [gl])

  useFrame((_, dt) => {
    const s = state.current
    if (!s.dragging) {
      s.velocity *= Math.pow(0.05, dt)
      s.azimuth += s.velocity + 0.012 * dt
    }
    const cam = camera as THREE.OrthographicCamera
    cam.position.set(
      Math.sin(s.azimuth) * ORBIT_RADIUS,
      ORBIT_HEIGHT,
      Math.cos(s.azimuth) * ORBIT_RADIUS,
    )
    cam.lookAt(0, 16, 0)
    // fit the whole 3x3 grid on landscape screens; portrait focuses the centre
    const fitted = size.height / 1480
    const zoom = fitted * s.zoom
    if (Math.abs(cam.zoom - zoom) > 1e-4) {
      cam.zoom = zoom
      cam.updateProjectionMatrix()
    }
  })

  return null
}

/** Directional light that follows the real sun (or a stylised moon at night). */
function SkyLight({ coords, weather }: { coords: Coords; weather: Weather }) {
  const theme = themeFor(weather.condition, weather.isDay)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const { position, color, intensity } = useMemo(() => {
    const sun = sunPosition(coords.lat, coords.lon)
    const up = sun.alt > 0.02
    const alt = up ? Math.max(sun.alt, 0.14) : 0.75
    const az = up ? sun.az : sun.az + Math.PI
    const position: [number, number, number] = [
      Math.cos(alt) * Math.sin(az) * 760,
      Math.sin(alt) * 760,
      -Math.cos(alt) * Math.cos(az) * 760,
    ]
    let color = new THREE.Color(theme.sun.color)
    const clearish = weather.condition === 'clear' || weather.condition === 'partly'
    if (up && clearish && sun.alt < 0.3) {
      // golden hour
      const f = 1 - Math.max(sun.alt, 0) / 0.3
      color = color.lerp(new THREE.Color('#ffac5e'), f * 0.85)
    }
    return { position, color, intensity: theme.sun.intensity }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, weather.condition, weather.isDay, theme, tick])

  return (
    <directionalLight
      position={position}
      color={color}
      intensity={intensity}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0002}
      shadow-normalBias={2.5}
    >
      <orthographicCamera attach="shadow-camera" args={[-760, 760, 760, -760, 10, 2000]} />
    </directionalLight>
  )
}

function SceneContents({
  world,
  weather,
  coords,
  terrain,
}: {
  world: WorldData
  weather: Weather
  coords: Coords
  terrain: Terrain
}) {
  const theme = useMemo(
    () => themeFor(weather.condition, weather.isDay),
    [weather.condition, weather.isDay],
  )
  const landmarks = useMemo(() => placeLandmarks(coords), [coords])
  const { scene, size } = useThree()
  // tilt-shift eases off on big screens; phones keep the strong miniature look
  const blur = size.width < 700 ? 0.12 : size.width < 1100 ? 0.07 : 0.045

  useEffect(() => {
    // density compensated for the doubled camera distance; kept light so
    // surfaces (asphalt especially) hold their colour
    scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity * 0.32)
    return () => {
      scene.fog = null
    }
  }, [scene, theme])

  // the Lego build-in clock: restarts whenever a new world mounts
  useEffect(() => {
    resetBuild()
  }, [world])
  useFrame((_, dt) => {
    buildUniform.value += dt
  })

  const raining =
    weather.condition === 'rain' ||
    weather.condition === 'drizzle' ||
    weather.condition === 'thunder'

  return (
    <>
      <OrbitRig />
      <ambientLight color={theme.ambient.color} intensity={theme.ambient.intensity} />
      <hemisphereLight
        color={theme.hemi.sky}
        groundColor={theme.hemi.ground}
        intensity={theme.hemi.intensity}
      />
      <SkyLight coords={coords} weather={weather} />

      <SkyDome
        theme={theme}
        isDay={weather.isDay}
        condition={weather.condition}
        coords={coords}
      />
      <Diorama
        world={world}
        theme={theme}
        isDay={weather.isDay}
        terrain={terrain}
        exclusions={landmarks}
      />
      <Landmarks placed={landmarks} terrain={terrain} />
      <Cars world={world} isDay={weather.isDay} terrain={terrain} />
      <ParkedCars world={world} terrain={terrain} />
      <Pedestrians world={world} isDay={weather.isDay} terrain={terrain} />
      <Boats world={world} terrain={terrain} />
      <Trains world={world} terrain={terrain} />
      <Balloon weather={weather} />
      <Flights coords={coords} isDay={weather.isDay} terrain={terrain} />
      <Birds weather={weather} />
      <Streetlamps world={world} isDay={weather.isDay} terrain={terrain} />
      <Smoke world={world} weather={weather} terrain={terrain} />

      <Clouds theme={theme} />
      {raining && <Rain heavy={weather.condition !== 'drizzle'} />}
      {weather.condition === 'snow' && <Snow />}
      {weather.condition === 'thunder' && <Lightning />}

      {/* miniature-look: glow on lit windows/lamps + tilt-shift blur */}
      <EffectComposer multisampling={4}>
        <Bloom
          intensity={weather.isDay ? 0.25 : 0.7}
          luminanceThreshold={weather.isDay ? 0.95 : 0.72}
          mipmapBlur
          radius={0.7}
        />
        <TiltShift2 blur={blur} />
      </EffectComposer>
    </>
  )
}

export function Scene({
  world,
  weather,
  coords,
  terrain,
}: {
  world: WorldData
  weather: Weather
  coords: Coords
  terrain: Terrain
}) {
  return (
    <Canvas
      orthographic
      shadows="soft"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, localClippingEnabled: true }}
      camera={{ position: [693, 650, 693], zoom: 1, near: 10, far: 5000 }}
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      onCreated={(state) => {
        // not a constructor param — must be set on the renderer instance
        state.gl.localClippingEnabled = true
        ;(window as unknown as Record<string, unknown>).__mw = state
      }}
    >
      <SceneContents world={world} weather={weather} coords={coords} terrain={terrain} />
    </Canvas>
  )
}
