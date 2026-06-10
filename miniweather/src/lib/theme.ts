import type { Condition } from './types'

export interface Theme {
  /** page background gradient (top, bottom) */
  bg: [string, string]
  fog: string
  fogDensity: number
  sun: { color: string; intensity: number }
  ambient: { color: string; intensity: number }
  hemi: { sky: string; ground: string; intensity: number }
  clouds: { color: string; count: number; opacity: number } | null
  snowGround: boolean
  wet: boolean
}

const THEMES: Record<Condition, { day: Theme; night: Theme }> = {
  clear: {
    day: {
      bg: ['#7ec8f7', '#cfeaff'],
      fog: '#bfe2fb',
      fogDensity: 0.0006,
      sun: { color: '#fff2d8', intensity: 2.6 },
      ambient: { color: '#dceaff', intensity: 0.5 },
      hemi: { sky: '#bfdcff', ground: '#e8d9c4', intensity: 0.9 },
      clouds: { color: '#ffffff', count: 2, opacity: 0.88 },
      snowGround: false,
      wet: false,
    },
    night: {
      bg: ['#0d1430', '#27355e'],
      fog: '#1a2342',
      fogDensity: 0.0008,
      sun: { color: '#9db4e8', intensity: 0.9 },
      ambient: { color: '#42507e', intensity: 0.75 },
      hemi: { sky: '#36446e', ground: '#1c1f2e', intensity: 0.7 },
      clouds: null,
      snowGround: false,
      wet: false,
    },
  },
  partly: {
    day: {
      bg: ['#8fc3ea', '#d8ecf9'],
      fog: '#c4ddf0',
      fogDensity: 0.0007,
      sun: { color: '#fff0d2', intensity: 2.1 },
      ambient: { color: '#dde9f8', intensity: 0.55 },
      hemi: { sky: '#bdd7f0', ground: '#e3d6c4', intensity: 0.85 },
      clouds: { color: '#ffffff', count: 4, opacity: 0.95 },
      snowGround: false,
      wet: false,
    },
    night: {
      bg: ['#111a38', '#2b3a64'],
      fog: '#1d2746',
      fogDensity: 0.0009,
      sun: { color: '#93a9dd', intensity: 0.6 },
      ambient: { color: '#414f7c', intensity: 0.55 },
      hemi: { sky: '#333f68', ground: '#1b1e2c', intensity: 0.6 },
      clouds: { color: '#39456b', count: 4, opacity: 0.9 },
      snowGround: false,
      wet: false,
    },
  },
  cloudy: {
    day: {
      bg: ['#9fb2c4', '#d4dde6'],
      fog: '#bccbd9',
      fogDensity: 0.001,
      sun: { color: '#e8edf4', intensity: 1.0 },
      ambient: { color: '#ccd6e2', intensity: 0.75 },
      hemi: { sky: '#b7c4d4', ground: '#c9c2b8', intensity: 0.8 },
      clouds: { color: '#e9eef3', count: 8, opacity: 0.96 },
      snowGround: false,
      wet: false,
    },
    night: {
      bg: ['#171d2e', '#2e3950'],
      fog: '#202637',
      fogDensity: 0.0012,
      sun: { color: '#7f8eb4', intensity: 0.45 },
      ambient: { color: '#3d4763', intensity: 0.6 },
      hemi: { sky: '#2f3850', ground: '#191c26', intensity: 0.55 },
      clouds: { color: '#2c3550', count: 8, opacity: 0.95 },
      snowGround: false,
      wet: false,
    },
  },
  fog: {
    day: {
      bg: ['#c3cdd4', '#e6ebee'],
      fog: '#d4dce1',
      fogDensity: 0.004,
      sun: { color: '#e9edf0', intensity: 0.7 },
      ambient: { color: '#d8dfe4', intensity: 0.9 },
      hemi: { sky: '#ccd5db', ground: '#c4beb4', intensity: 0.7 },
      clouds: { color: '#dee5e9', count: 5, opacity: 0.5 },
      snowGround: false,
      wet: false,
    },
    night: {
      bg: ['#1b2129', '#333d49'],
      fog: '#272f3a',
      fogDensity: 0.0045,
      sun: { color: '#76849c', intensity: 0.35 },
      ambient: { color: '#3c4656', intensity: 0.7 },
      hemi: { sky: '#303a48', ground: '#181b21', intensity: 0.5 },
      clouds: { color: '#2d3645', count: 5, opacity: 0.45 },
      snowGround: false,
      wet: false,
    },
  },
  drizzle: {
    day: {
      bg: ['#8da4b8', '#c8d6e0'],
      fog: '#aebfce',
      fogDensity: 0.0014,
      sun: { color: '#dde5ee', intensity: 0.9 },
      ambient: { color: '#c2cedb', intensity: 0.75 },
      hemi: { sky: '#aabccd', ground: '#b3aca2', intensity: 0.75 },
      clouds: { color: '#dbe3ea', count: 7, opacity: 0.95 },
      snowGround: false,
      wet: true,
    },
    night: {
      bg: ['#141a28', '#2a3447'],
      fog: '#1e2533',
      fogDensity: 0.0016,
      sun: { color: '#6e7d9b', intensity: 0.4 },
      ambient: { color: '#384256', intensity: 0.6 },
      hemi: { sky: '#2b344a', ground: '#161922', intensity: 0.5 },
      clouds: { color: '#262f47', count: 7, opacity: 0.95 },
      snowGround: false,
      wet: true,
    },
  },
  rain: {
    day: {
      bg: ['#768ba0', '#b4c5d2'],
      fog: '#9bafc0',
      fogDensity: 0.0016,
      sun: { color: '#d3dde8', intensity: 0.8 },
      ambient: { color: '#b6c4d4', intensity: 0.75 },
      hemi: { sky: '#9cb0c2', ground: '#a09a91', intensity: 0.7 },
      clouds: { color: '#c3ccd6', count: 9, opacity: 0.97 },
      snowGround: false,
      wet: true,
    },
    night: {
      bg: ['#10141f', '#242d3e'],
      fog: '#1a2030',
      fogDensity: 0.0018,
      sun: { color: '#5f6e8c', intensity: 0.35 },
      ambient: { color: '#333d54', intensity: 0.6 },
      hemi: { sky: '#272f44', ground: '#13151d', intensity: 0.5 },
      clouds: { color: '#202840', count: 9, opacity: 0.96 },
      snowGround: false,
      wet: true,
    },
  },
  snow: {
    day: {
      bg: ['#b6c6d6', '#eef3f7'],
      fog: '#d4dee7',
      fogDensity: 0.0018,
      sun: { color: '#f2f5f9', intensity: 1.2 },
      ambient: { color: '#e2e9f0', intensity: 0.85 },
      hemi: { sky: '#ccd9e6', ground: '#e8ecf0', intensity: 0.8 },
      clouds: { color: '#e8edf2', count: 7, opacity: 0.92 },
      snowGround: true,
      wet: false,
    },
    night: {
      bg: ['#1a2233', '#3a4763'],
      fog: '#2a3349',
      fogDensity: 0.002,
      sun: { color: '#8e9fc4', intensity: 0.55 },
      ambient: { color: '#4a5778', intensity: 0.7 },
      hemi: { sky: '#3a4768', ground: '#2c3242', intensity: 0.55 },
      clouds: { color: '#323d5c', count: 7, opacity: 0.92 },
      snowGround: true,
      wet: false,
    },
  },
  thunder: {
    day: {
      bg: ['#4f5d72', '#96a8b8'],
      fog: '#6b7a8e',
      fogDensity: 0.002,
      sun: { color: '#aebccf', intensity: 0.55 },
      ambient: { color: '#8b9ab0', intensity: 0.7 },
      hemi: { sky: '#76879c', ground: '#6f6a64', intensity: 0.6 },
      clouds: { color: '#828f9f', count: 10, opacity: 0.98 },
      snowGround: false,
      wet: true,
    },
    night: {
      bg: ['#0b0e17', '#1d2332'],
      fog: '#141927',
      fogDensity: 0.0022,
      sun: { color: '#4d5b78', intensity: 0.3 },
      ambient: { color: '#2c3548', intensity: 0.6 },
      hemi: { sky: '#212940', ground: '#0f1117', intensity: 0.45 },
      clouds: { color: '#181f33', count: 10, opacity: 0.97 },
      snowGround: false,
      wet: true,
    },
  },
}

export function themeFor(condition: Condition, isDay: boolean): Theme {
  const t = THEMES[condition] ?? THEMES.cloudy
  return isDay ? t.day : t.night
}
