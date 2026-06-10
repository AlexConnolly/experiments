import type { Condition, Coords, Weather } from './types'

function mapWmo(code: number): { condition: Condition; description: string } {
  if (code === 0) return { condition: 'clear', description: 'clear skies' }
  if (code === 1) return { condition: 'clear', description: 'mostly clear' }
  if (code === 2) return { condition: 'partly', description: 'partly cloudy' }
  if (code === 3) return { condition: 'cloudy', description: 'overcast' }
  if (code === 45 || code === 48) return { condition: 'fog', description: 'foggy' }
  if (code >= 51 && code <= 57)
    return { condition: 'drizzle', description: 'light drizzle' }
  if (code >= 61 && code <= 63) return { condition: 'rain', description: 'raining' }
  if (code >= 65 && code <= 67)
    return { condition: 'rain', description: 'heavy rain' }
  if (code >= 71 && code <= 77) return { condition: 'snow', description: 'snowing' }
  if (code >= 80 && code <= 82)
    return { condition: 'rain', description: 'rain showers' }
  if (code === 85 || code === 86)
    return { condition: 'snow', description: 'snow showers' }
  if (code >= 95) return { condition: 'thunder', description: 'thunderstorm' }
  return { condition: 'cloudy', description: 'cloudy' }
}

export async function fetchWeather(coords: Coords): Promise<Weather> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${coords.lat}&longitude=${coords.lon}` +
    '&current=temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,cloud_cover' +
    '&timezone=auto'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`open-meteo ${res.status}`)
  const data = await res.json()
  const c = data.current
  const { condition, description } = mapWmo(c.weather_code)
  return {
    temperature: Math.round(c.temperature_2m),
    feelsLike: Math.round(c.apparent_temperature),
    condition,
    isDay: c.is_day === 1,
    windSpeed: c.wind_speed_10m,
    cloudCover: c.cloud_cover,
    description,
  }
}
