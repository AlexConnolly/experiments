import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Condition, Coords } from '../lib/types'
import type { Theme } from '../lib/theme'
import { starCatalog, sunPosition, toHorizontal, type Star } from '../lib/astro'
import { puffTexture } from '../lib/textures'
import { WORLD_HALF } from './Diorama'

function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/* --------------------------------- sky dome --------------------------------- */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uWisp;
uniform float uWispAmount;
uniform float uTime;
uniform sampler2D uCelestial;
varying vec3 vDir;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  v += 0.55 * vnoise(p);
  v += 0.27 * vnoise(p * 2.13 + 17.7);
  v += 0.18 * vnoise(p * 4.41 + 41.3);
  return v;
}

void main() {
  // the island floats in an endless sky: mirror the gradient below the horizon
  float h = abs(vDir.y);
  float t = pow(smoothstep(0.0, 0.9, h), 0.62);
  vec3 col = mix(uHorizon, uZenith, t);

  // high wispy cloud streaks, stretched horizontally and drifting slowly
  vec2 sky = vec2(atan(vDir.x, vDir.z) * 3.0, vDir.y * 6.0);
  float w = fbm(sky * vec2(0.9, 0.55) + vec2(uTime * 0.012, 0.0));
  float band = smoothstep(0.06, 0.35, h) * (1.0 - smoothstep(0.55, 0.95, h));
  col = mix(col, uWisp, smoothstep(0.55, 0.9, w) * band * uWispAmount);

  // fine haze grain so the gradient never reads as flat colour
  float g = fbm(sky * 3.1 - vec2(uTime * 0.02, 0.0));
  col += (g - 0.5) * 0.01;

  // gentle glow hugging the horizon line
  col += uHorizon * 0.18 * exp(-h * 7.0);

  // stars / sun / moon are painted straight onto the backdrop
  vec2 cuv = vec2(
    atan(vDir.x, vDir.z) / 6.2831853 + 0.5,
    asin(clamp(vDir.y, -1.0, 1.0)) / 3.14159265 + 0.5
  );
  vec4 cel = texture2D(uCelestial, cuv);
  col += cel.rgb * cel.a;

  // dither to kill banding
  col += (hash(gl_FragCoord.xy) - 0.5) * 0.012;
  gl_FragColor = vec4(col, 1.0);
}
`

/** Paint stars, moon and sun onto the equirect backdrop canvas. */
function paintCelestial(
  canvas: HTMLCanvasElement,
  stars: Star[] | null,
  coords: Coords,
  showSun: boolean,
  showNightSky: boolean,
) {
  const W = canvas.width
  const H = canvas.height
  const g = canvas.getContext('2d')!
  g.clearRect(0, 0, W, H)

  const toXY = (alt: number, az: number): [number, number] => {
    const x = Math.cos(alt) * Math.sin(az)
    const y = Math.sin(alt)
    const z = -Math.cos(alt) * Math.cos(az)
    const u = Math.atan2(x, z) / (Math.PI * 2) + 0.5
    const v = Math.asin(THREE.MathUtils.clamp(y, -1, 1)) / Math.PI + 0.5
    return [u * W, (1 - v) * H]
  }

  const glowAt = (px: number, py: number, r: number, rgb: string, a: number) => {
    const grad = g.createRadialGradient(px, py, 0, px, py, r)
    grad.addColorStop(0, `rgba(${rgb},${a})`)
    grad.addColorStop(0.4, `rgba(${rgb},${a * 0.35})`)
    grad.addColorStop(1, `rgba(${rgb},0)`)
    g.fillStyle = grad
    g.fillRect(px - r, py - r, r * 2, r * 2)
  }

  const now = new Date()
  const sun = sunPosition(coords.lat, coords.lon, now)

  if (showNightSky) {
    if (stars) {
      for (const star of stars) {
        const { alt, az } = toHorizontal(star.ra, star.dec, coords.lat, coords.lon, now)
        if (alt < 0.02) continue
        const [px, py] = toXY(alt, az)
        const a = THREE.MathUtils.clamp(1.2 - star.mag * 0.16, 0.25, 1)
        const r = THREE.MathUtils.clamp(2.7 - star.mag * 0.4, 0.9, 2.7)
        if (star.mag < 1.6) glowAt(px, py, 7, '210,225,255', 0.45)
        g.fillStyle = `rgba(235,242,255,${a})`
        g.beginPath()
        g.arc(px, py, r, 0, Math.PI * 2)
        g.fill()
        // mirrored twin below the horizon so the backdrop around the island twinkles too
        g.beginPath()
        g.arc(px, H - py, r, 0, Math.PI * 2)
        g.fill()
      }
    }
    // stylised moon opposite the sun's bearing
    const [mx, my] = toXY(0.6, sun.az + Math.PI)
    glowAt(mx, my, 150, '190,205,240', 0.5)
    g.fillStyle = '#eef2fc'
    g.beginPath()
    g.arc(mx, my, 36, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#cfd8ea'
    for (const [ox, oy, cr] of [
      [11, -8, 7], [-9, 6, 5], [3, 14, 3.6],
    ] as const) {
      g.beginPath()
      g.arc(mx + ox, my + oy, cr, 0, Math.PI * 2)
      g.fill()
    }
  }

  if (showSun) {
    const [sx, sy] = toXY(Math.max(sun.alt, 0.18), sun.az)
    glowAt(sx, sy, 300, '255,225,160', 0.65)
    g.fillStyle = '#fff4c8'
    g.beginPath()
    g.arc(sx, sy, 46, 0, Math.PI * 2)
    g.fill()
  }
}

export function SkyDome({
  theme,
  isDay,
  condition,
  coords,
}: {
  theme: Theme
  isDay: boolean
  condition: Condition
  coords: Coords
}) {
  const [catalog, setCatalog] = useState<Star[] | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    starCatalog().then((s) => alive && setCatalog(s))
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const celestial = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 4096
    canvas.height = 2048
    const t = new THREE.CanvasTexture(canvas)
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    return t
  }, [])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uZenith: { value: new THREE.Color(theme.bg[0]) },
          uHorizon: { value: new THREE.Color(theme.bg[1]) },
          uWisp: { value: new THREE.Color('#ffffff') },
          uWispAmount: { value: 0.35 },
          uTime: { value: 0 },
          uCelestial: { value: celestial },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    material.uniforms.uZenith.value.set(theme.bg[0])
    material.uniforms.uHorizon.value.set(theme.bg[1])
    // wisps: bright in daylight, faint silver at night, denser when overcast
    const wisp = new THREE.Color(theme.bg[0]).lerp(
      new THREE.Color(isDay ? '#ffffff' : '#8a97c0'),
      isDay ? 0.85 : 0.4,
    )
    material.uniforms.uWisp.value.copy(wisp)
    // clear skies stay clean — wisps belong to overcast moods, and barely at night
    material.uniforms.uWispAmount.value = theme.clouds ? (isDay ? 0.45 : 0.18) : 0.08
  }, [material, theme, isDay])

  // repaint the backdrop whenever the sky's contents could change
  useEffect(() => {
    const clearish = condition === 'clear' || condition === 'partly'
    paintCelestial(
      celestial.image as HTMLCanvasElement,
      catalog,
      coords,
      isDay && clearish,
      !isDay && clearish,
    )
    celestial.needsUpdate = true
  }, [celestial, catalog, coords, condition, isDay, tick])

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime
  })

  return (
    <mesh material={material} renderOrder={-10}>
      <sphereGeometry args={[2300, 48, 24]} />
    </mesh>
  )
}

/* ---------------------------------- clouds --------------------------------- */

function CloudPuff({ seed, color, opacity }: { seed: number; color: string; opacity: number }) {
  const map = puffTexture()
  const blobs = useMemo(() => {
    const n = 6 + Math.floor(rand(seed) * 4)
    return Array.from({ length: n }, (_, i) => {
      const spread = i / n
      return {
        pos: [
          (spread - 0.5) * (46 + rand(seed + i * 2.3) * 22),
          (rand(seed + i * 5.1) - 0.5) * 8 - Math.abs(spread - 0.5) * 10,
          (rand(seed + i * 7.7) - 0.5) * 18,
        ] as [number, number, number],
        scale: 24 + rand(seed + i * 11.3) * 26 - Math.abs(spread - 0.5) * 18,
        o: 0.5 + rand(seed + i * 13.7) * 0.5,
      }
    })
  }, [seed])
  return (
    <group>
      {blobs.map((b, i) => (
        <sprite key={i} position={b.pos} scale={[b.scale, b.scale * 0.62, 1]}>
          <spriteMaterial
            map={map}
            color={color}
            transparent
            opacity={opacity * b.o}
            depthWrite={false}
            rotation={rand(seed + i) * Math.PI}
            fog={false}
          />
        </sprite>
      ))}
    </group>
  )
}

export function Clouds({ theme }: { theme: Theme }) {
  const group = useRef<THREE.Group>(null)
  const cloudData = useMemo(() => {
    if (!theme.clouds) return []
    const count = Math.round(theme.clouds.count * 1.7)
    return Array.from({ length: count }, (_, i) => ({
      x: (rand(i * 13.7) - 0.5) * WORLD_HALF * 1.7,
      y: 120 + rand(i * 3.1) * 70,
      z: (rand(i * 23.3) - 0.5) * WORLD_HALF * 1.7,
      speed: 2 + rand(i * 31.7) * 3,
      seed: i * 17.9,
    }))
  }, [theme.clouds])

  useFrame((_, dt) => {
    if (!group.current) return
    group.current.children.forEach((cloud, i) => {
      cloud.position.x += cloudData[i].speed * dt
      if (cloud.position.x > WORLD_HALF * 1.1) cloud.position.x = -WORLD_HALF * 1.1
    })
  })

  if (!theme.clouds) return null
  return (
    <group ref={group}>
      {cloudData.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]}>
          <CloudPuff seed={c.seed} color={theme.clouds!.color} opacity={theme.clouds!.opacity} />
        </group>
      ))}
    </group>
  )
}

/* ----------------------------------- rain ---------------------------------- */

export function Rain({ heavy }: { heavy: boolean }) {
  const ref = useRef<THREE.LineSegments>(null)
  const count = heavy ? 1400 : 650
  const { geometry, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 6)
    const speeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const x = (rand(i * 1.1) - 0.5) * WORLD_HALF * 1.9
      const z = (rand(i * 2.7) - 0.5) * WORLD_HALF * 1.9
      const y = rand(i * 3.9) * 160
      const len = 5 + rand(i * 5.3) * 4
      positions.set([x, y, z, x, y - len, z], i * 6)
      speeds[i] = 90 + rand(i * 7.7) * 60
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return { geometry, speeds }
  }, [count])

  useFrame((_, dt) => {
    if (!ref.current) return
    const pos = ref.current.geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < count; i++) {
      const fall = speeds[i] * dt
      arr[i * 6 + 1] -= fall
      arr[i * 6 + 4] -= fall
      if (arr[i * 6 + 1] < 0) {
        const reset = 140 + rand(i + arr[i * 6]) * 30
        const len = arr[i * 6 + 1] - arr[i * 6 + 4]
        arr[i * 6 + 1] = reset
        arr[i * 6 + 4] = reset - len
      }
    }
    pos.needsUpdate = true
  })

  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial color="#a8c4dd" transparent opacity={heavy ? 0.55 : 0.4} />
    </lineSegments>
  )
}

/* ----------------------------------- snow ---------------------------------- */

export function Snow() {
  const ref = useRef<THREE.Points>(null)
  const count = 1100
  const { geometry, phase } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const phase = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rand(i * 1.3) - 0.5) * WORLD_HALF * 1.9
      positions[i * 3 + 1] = rand(i * 2.9) * 150
      positions[i * 3 + 2] = (rand(i * 4.1) - 0.5) * WORLD_HALF * 1.9
      phase[i] = rand(i * 6.7) * Math.PI * 2
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return { geometry, phase }
  }, [])

  useFrame(({ clock }, dt) => {
    if (!ref.current) return
    const pos = ref.current.geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const t = clock.elapsedTime
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] -= (7 + 4 * rand(i)) * dt
      arr[i * 3] += Math.sin(t * 0.8 + phase[i]) * 2.5 * dt
      if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = 140 + rand(i + t) * 20
    }
    pos.needsUpdate = true
  })

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial color="#ffffff" size={4} sizeAttenuation={false} transparent opacity={0.9} />
    </points>
  )
}

/* --------------------------------- lightning -------------------------------- */

export function Lightning() {
  const light = useRef<THREE.DirectionalLight>(null)
  const state = useRef({ next: 3 + Math.random() * 5, flash: 0 })

  useFrame((_, dt) => {
    const s = state.current
    s.next -= dt
    if (s.next <= 0) {
      s.flash = 1
      s.next = 4 + Math.random() * 9
    }
    if (s.flash > 0) {
      s.flash = Math.max(0, s.flash - dt * 4)
      const f = s.flash
      const pulse = f > 0.6 ? (f - 0.6) / 0.4 : f > 0.35 ? 0 : f / 0.35
      if (light.current) light.current.intensity = pulse * 6
    } else if (light.current) {
      light.current.intensity = 0
    }
  })

  return (
    <directionalLight
      ref={light}
      position={[-80, 220, -60]}
      intensity={0}
      color="#dfe8ff"
    />
  )
}

/* sun, moon and stars are painted into the SkyDome backdrop above */
