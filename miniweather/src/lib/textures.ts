import * as THREE from 'three'

/** All texture art is generated on canvases — no image assets. */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

function tex(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
  }
  t.anisotropy = 4
  // without this, colour maps render ~2.5x too bright (washed-out roads etc.)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function mulberry(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Window tile layout shared by the day map and night emissive map. */
const COLS = 8
const ROWS = 6
const CELL = 42
/** World metres covered by one full texture tile (3 m per window column). */
export const WINDOW_REPEAT: [number, number] = [1 / (COLS * 3), 1 / (ROWS * 3.1)]

function windowRect(cx: number, cy: number) {
  const x = cx * CELL + 11
  const y = cy * CELL + 9
  return [x, y, CELL - 22, CELL - 15] as const
}

let _windowDay: THREE.CanvasTexture | null = null
export function windowDayTexture(): THREE.CanvasTexture {
  if (_windowDay) return _windowDay
  const [c, g] = canvas(COLS * CELL, ROWS * CELL)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, c.width, c.height)
  const rnd = mulberry(7)
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const [wx, wy, ww, wh] = windowRect(x, y)
      const shade = 175 + Math.floor(rnd() * 40)
      g.fillStyle = `rgb(${shade - 18},${shade - 8},${shade + 8})`
      g.fillRect(wx, wy, ww, wh)
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.fillRect(wx, wy, ww, 4)
    }
  }
  _windowDay = tex(c)
  return _windowDay
}

let _windowNight: THREE.CanvasTexture | null = null
let _nightCtx: CanvasRenderingContext2D | null = null
const _lit: boolean[] = []
const _flickerRnd = mulberry(23)

function drawCell(g: CanvasRenderingContext2D, idx: number) {
  const x = idx % COLS
  const y = Math.floor(idx / COLS)
  const [wx, wy, ww, wh] = windowRect(x, y)
  if (_lit[idx]) {
    g.fillStyle = _flickerRnd() > 0.25 ? '#ffc56e' : '#ffe9c0'
    g.fillRect(wx, wy, ww, wh)
  } else {
    g.fillStyle = '#000000'
    g.fillRect(wx - 1, wy - 1, ww + 2, wh + 2)
  }
}

export function windowNightTexture(): THREE.CanvasTexture {
  if (_windowNight) return _windowNight
  const [c, g] = canvas(COLS * CELL, ROWS * CELL)
  g.fillStyle = '#000000'
  g.fillRect(0, 0, c.width, c.height)
  for (let i = 0; i < COLS * ROWS; i++) {
    _lit[i] = _flickerRnd() < 0.42
    drawCell(g, i)
  }
  _nightCtx = g
  _windowNight = tex(c)
  return _windowNight
}

/**
 * Toggle a couple of window cells. The texture tiles across every facade, so
 * each flip reads as a handful of lights going on or off around the city.
 */
export function flickerNightWindows() {
  if (!_nightCtx || !_windowNight) return
  const flips = 1 + Math.floor(_flickerRnd() * 2)
  for (let f = 0; f < flips; f++) {
    const idx = Math.floor(_flickerRnd() * COLS * ROWS)
    _lit[idx] = !_lit[idx]
    drawCell(_nightCtx, idx)
  }
  _windowNight.needsUpdate = true
}

/** Asphalt with a dashed centre line. u: 1 repeat = 8 m of road, v: across. */
let _asphalt: THREE.CanvasTexture | null = null
export function asphaltTexture(): THREE.CanvasTexture {
  if (_asphalt) return _asphalt
  const [c, g] = canvas(256, 128)
  // dark asphalt base — the material colour is the line colour, the base
  // multiplies it down so dashes read bright against the surface
  g.fillStyle = 'rgb(42,44,52)'
  g.fillRect(0, 0, 256, 128)
  const rnd = mulberry(99)
  for (let i = 0; i < 700; i++) {
    const v = 36 + Math.floor(rnd() * 32)
    g.fillStyle = `rgba(${v},${v},${v + 7},0.6)`
    g.fillRect(rnd() * 256, rnd() * 128, 2, 2)
  }
  // kerb lines along both edges
  g.fillStyle = 'rgba(243,246,250,0.95)'
  g.fillRect(0, 0, 256, 9)
  g.fillRect(0, 119, 256, 9)
  // dashed centre line, slightly warm like real paint
  g.fillStyle = 'rgba(255,250,225,1)'
  g.fillRect(14, 57, 138, 14)
  _asphalt = tex(c)
  return _asphalt
}

/** Railway: ballast, sleepers and two steel rails. u: 1 repeat = 8 m of track. */
let _rail: THREE.CanvasTexture | null = null
export function railTexture(): THREE.CanvasTexture {
  if (_rail) return _rail
  const [c, g] = canvas(128, 64)
  g.fillStyle = 'rgb(96,90,82)'
  g.fillRect(0, 0, 128, 64)
  const rnd = mulberry(404)
  for (let i = 0; i < 250; i++) {
    const v = 78 + Math.floor(rnd() * 40)
    g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.6)`
    g.fillRect(rnd() * 128, rnd() * 64, 2, 2)
  }
  // sleepers roughly every metre
  g.fillStyle = 'rgb(58,48,40)'
  for (let x = 2; x < 128; x += 16) g.fillRect(x, 10, 7, 44)
  // two steel rails running along the track
  g.fillStyle = 'rgb(165,168,172)'
  g.fillRect(0, 18, 128, 4)
  g.fillRect(0, 42, 128, 4)
  _rail = tex(c)
  return _rail
}

/** Runway: very dark tarmac with a dashed white centreline. 1 repeat = 8 m. */
let _runway: THREE.CanvasTexture | null = null
export function runwayTexture(): THREE.CanvasTexture {
  if (_runway) return _runway
  const [c, g] = canvas(256, 128)
  g.fillStyle = 'rgb(36,38,42)'
  g.fillRect(0, 0, 256, 128)
  const rnd = mulberry(747)
  for (let i = 0; i < 600; i++) {
    const v = 30 + Math.floor(rnd() * 26)
    g.fillStyle = `rgba(${v},${v},${v + 4},0.6)`
    g.fillRect(rnd() * 256, rnd() * 128, 2, 2)
  }
  // edge stripes
  g.fillStyle = 'rgba(255,255,255,0.85)'
  g.fillRect(0, 4, 256, 5)
  g.fillRect(0, 119, 256, 5)
  // centreline dash (half on, half off per 8 m repeat)
  g.fillRect(0, 60, 128, 8)
  _runway = tex(c)
  return _runway
}

/** Scrolling water: layered streaks of light over deep blue. 1 repeat ≈ 30 m. */
let _water: THREE.CanvasTexture | null = null
export function waterTexture(): THREE.CanvasTexture {
  if (_water) return _water
  const [c, g] = canvas(256, 256)
  g.fillStyle = 'rgb(190,212,235)'
  g.fillRect(0, 0, 256, 256)
  const rnd = mulberry(7331)
  for (let i = 0; i < 90; i++) {
    const y = rnd() * 256
    const x = rnd() * 256
    const w = 30 + rnd() * 90
    const bright = rnd() > 0.45
    g.strokeStyle = bright ? 'rgba(255,255,255,0.5)' : 'rgba(120,150,190,0.45)'
    g.lineWidth = 2 + rnd() * 4
    g.beginPath()
    g.moveTo(x - w / 2, y)
    g.quadraticCurveTo(x, y + (rnd() - 0.5) * 14, x + w / 2, y)
    g.stroke()
  }
  _water = tex(c)
  return _water
}

/** Grass speckle for parks. 1 repeat ≈ 18 m. */
let _grass: THREE.CanvasTexture | null = null
export function grassTexture(): THREE.CanvasTexture {
  if (_grass) return _grass
  const [c, g] = canvas(256, 256)
  g.fillStyle = 'rgb(238,240,232)'
  g.fillRect(0, 0, 256, 256)
  const rnd = mulberry(515)
  for (let i = 0; i < 2400; i++) {
    const v = 200 + Math.floor(rnd() * 56)
    g.fillStyle = `rgba(${v - 30},${v},${v - 50},0.55)`
    g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 2, 2 + rnd() * 2)
  }
  _grass = tex(c)
  return _grass
}

/** Paving grain for the plinth top. */
let _paving: THREE.CanvasTexture | null = null
export function pavingTexture(): THREE.CanvasTexture {
  if (_paving) return _paving
  const [c, g] = canvas(256, 256)
  g.fillStyle = 'rgb(240,238,233)'
  g.fillRect(0, 0, 256, 256)
  const rnd = mulberry(2024)
  for (let i = 0; i < 1700; i++) {
    const v = 205 + Math.floor(rnd() * 50)
    g.fillStyle = `rgba(${v},${v - 3},${v - 9},0.5)`
    g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 3, 2 + rnd() * 3)
  }
  // faint paving grid
  g.strokeStyle = 'rgba(160,155,145,0.25)'
  g.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    g.beginPath()
    g.moveTo(i * 64, 0)
    g.lineTo(i * 64, 256)
    g.stroke()
    g.beginPath()
    g.moveTo(0, i * 64)
    g.lineTo(256, i * 64)
    g.stroke()
  }
  _paving = tex(c)
  return _paving
}

/** Soft round puff for clouds. */
let _puff: THREE.CanvasTexture | null = null
export function puffTexture(): THREE.CanvasTexture {
  if (_puff) return _puff
  const [c, g] = canvas(256, 256)
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 126)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.85)')
  grad.addColorStop(0.8, 'rgba(255,255,255,0.25)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  _puff = tex(c, false)
  return _puff
}

/** Radial glow for the sun, moon and lamps. */
let _glow: THREE.CanvasTexture | null = null
export function glowTexture(): THREE.CanvasTexture {
  if (_glow) return _glow
  const [c, g] = canvas(256, 256)
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)')
  grad.addColorStop(0.6, 'rgba(255,255,255,0.08)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  _glow = tex(c, false)
  return _glow
}
