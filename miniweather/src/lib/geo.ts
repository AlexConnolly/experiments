import type { Coords } from './types'

const FALLBACK: Coords = { lat: 51.5074, lon: -0.1278, approximate: true }

function browserLocation(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('no geolocation'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          approximate: false,
        }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  })
}

async function ipLocation(): Promise<Coords> {
  const res = await fetch('https://ipapi.co/json/')
  if (!res.ok) throw new Error(`ip lookup ${res.status}`)
  const data = await res.json()
  if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number')
    throw new Error('ip lookup gave no coordinates')
  return { lat: data.latitude, lon: data.longitude, approximate: true }
}

export async function locate(): Promise<Coords> {
  try {
    return await browserLocation()
  } catch {
    try {
      return await ipLocation()
    } catch {
      return FALLBACK
    }
  }
}

export async function placeName(coords: Coords): Promise<string> {
  try {
    const url =
      'https://api.bigdatacloud.net/data/reverse-geocode-client' +
      `?latitude=${coords.lat}&longitude=${coords.lon}&localityLanguage=en`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`reverse geocode ${res.status}`)
    const data = await res.json()
    const name =
      data.city || data.locality || data.principalSubdivision || data.countryName
    return name || 'Somewhere on Earth'
  } catch {
    return 'Somewhere on Earth'
  }
}
