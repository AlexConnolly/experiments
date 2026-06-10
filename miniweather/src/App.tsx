import { useEffect, useMemo, useRef, useState } from 'react'
import type { Condition, Coords, Weather, WorldData } from './lib/types'
import { locate, placeName } from './lib/geo'
import { fetchWeather } from './lib/weather'
import { fetchWorld } from './lib/osm'
import { themeFor } from './lib/theme'
import { ambience } from './lib/ambience'
import { CITIES, type City } from './lib/cities'
import { Scene } from './world/Scene'

/** `?force=rain-day`, `?force=snow`, `?force=thunder-night`… for previewing moods. */
function applyForcedWeather(w: Weather): Weather {
  const force = new URLSearchParams(window.location.search).get('force')
  if (!force) return w
  const parts = force.split('-')
  const conditions: Condition[] = [
    'clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'thunder',
  ]
  const condition = conditions.find((c) => parts.includes(c)) ?? w.condition
  const isDay = parts.includes('night') ? false : parts.includes('day') ? true : w.isDay
  return { ...w, condition, isDay, description: `${condition} (preview)` }
}

function SoundButton({ weather }: { weather: Weather | null }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (weather) ambience.setWeather(weather.condition, weather.isDay)
  }, [weather])
  return (
    <button
      onClick={() => setOn(ambience.toggle())}
      aria-label={on ? 'mute ambience' : 'play ambience'}
      className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full
                 bg-white/15 text-white backdrop-blur-md transition-all duration-300
                 hover:bg-white/25 active:scale-90"
    >
      {on ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
          <line x1="16" y1="9" x2="22" y2="15" />
          <line x1="22" y1="9" x2="16" y2="15" />
        </svg>
      )}
    </button>
  )
}

interface GeoResult {
  name: string
  latitude: number
  longitude: number
  admin1?: string
  country?: string
}

/** Magnifier that expands into an autocomplete for any place on Earth. */
function PlaceSearch({ onPick }: { onPick: (city: City) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GeoResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    const id = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`,
        )
        const data = await res.json()
        setResults((data.results as GeoResult[]) ?? [])
      } catch {
        setResults([])
      }
    }, 280)
    return () => clearTimeout(id)
  }, [q])

  const pick = (r: GeoResult) => {
    onPick({ name: r.name, lat: r.latitude, lon: r.longitude })
    setOpen(false)
    setQ('')
    setResults([])
  }

  return (
    <div className="pointer-events-auto relative shrink-0">
      {open ? (
        <input
          ref={(el) => {
            inputRef.current = el
            el?.focus()
          }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) pick(results[0])
            if (e.key === 'Escape') {
              setOpen(false)
              setQ('')
              setResults([])
            }
          }}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="anywhere on earth…"
          className="w-44 rounded-full bg-white/85 px-4 py-1.5 text-[12px] font-semibold
                     text-slate-800 shadow-lg outline-none backdrop-blur-md
                     placeholder:text-slate-400"
        />
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="search for a place"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full
                     bg-white/12 text-white/80 backdrop-blur-md transition-all
                     duration-300 hover:bg-white/22 active:scale-95"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
        </button>
      )}
      {open && results.length > 0 && (
        <div
          className="absolute bottom-full left-0 mb-2 w-60 overflow-hidden rounded-2xl
                     bg-white/90 shadow-xl backdrop-blur-md"
        >
          {results.map((r, i) => (
            <button
              key={`${r.name}${r.latitude}${i}`}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(r)
              }}
              className="block w-full px-4 py-2 text-left text-[12px] font-semibold
                         text-slate-800 hover:bg-slate-100"
            >
              {r.name}
              <span className="ml-1 font-normal text-slate-400">
                {[r.admin1, r.country].filter(Boolean).join(', ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CityBar({
  active,
  onPick,
}: {
  active: City | null
  onPick: (city: City | null) => void
}) {
  const pill = (selected: boolean) =>
    `pointer-events-auto shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold
     tracking-wide backdrop-blur-md transition-all duration-300 active:scale-95 ${
       selected
         ? 'bg-white/85 text-slate-800 shadow-lg'
         : 'bg-white/12 text-white/80 hover:bg-white/22'
     }`
  return (
    <div className="pointer-events-auto flex max-w-full items-center gap-2 px-6 pb-1">
      <PlaceSearch onPick={onPick} />
      <div
        className="flex items-center gap-2 overflow-x-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        <button className={pill(active === null)} onClick={() => onPick(null)}>
          ◉ here
        </button>
        {CITIES.map((city) => (
          <button
            key={city.name}
            className={pill(active?.name === city.name)}
            onClick={() => onPick(city)}
          >
            {city.name}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [userCoords, setUserCoords] = useState<Coords | null>(null)
  const [city, setCity] = useState<City | null>(null)
  const [place, setPlace] = useState<string>('')
  const [weather, setWeather] = useState<Weather | null>(null)
  const [world, setWorld] = useState<WorldData | null>(null)
  const [worldError, setWorldError] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const weatherTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false
    locate().then((c) => {
      if (!cancelled) setUserCoords(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const coords: Coords | null = useMemo(() => {
    if (city) return { lat: city.lat, lon: city.lon, approximate: false }
    return userCoords
  }, [city, userCoords])

  useEffect(() => {
    if (!coords) return
    let cancelled = false
    setWorld(null)
    setWorldError(false)
    setWeather(null)
    setPlace(city ? city.name : '')

    placeName(coords).then((n) => !cancelled && setPlace(n))
    fetchWorld(coords)
      .then((w) => !cancelled && setWorld(w))
      .catch(() => !cancelled && setWorldError(true))

    const loadWeather = () =>
      fetchWeather(coords)
        .then((w) => !cancelled && setWeather(applyForcedWeather(w)))
        .catch(() => {})
    void loadWeather()
    weatherTimer.current = setInterval(loadWeather, 10 * 60 * 1000)
    return () => {
      cancelled = true
      if (weatherTimer.current) clearInterval(weatherTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, retryTick])

  const theme = weather ? themeFor(weather.condition, weather.isDay) : null
  const bg = theme
    ? `linear-gradient(to bottom, ${theme.bg[0]}, ${theme.bg[1]})`
    : 'linear-gradient(to bottom, #232c47, #3b4a73)'

  const ready = weather && (world || worldError)

  return (
    <div
      className="relative h-full w-full overflow-hidden transition-[background] duration-[2500ms]"
      style={{ background: bg }}
    >
      {ready && world && coords && (
        <Scene
          key={`${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`}
          world={world}
          weather={weather}
          coords={coords}
        />
      )}

      {/* soft vignette to pull the eye to the diorama */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 50%, rgba(6,8,22,0.35) 100%)',
        }}
      />

      {/* loading */}
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
          <div className="mw-breathe h-3 w-3 rounded-full bg-white/90" />
          <p className="text-sm font-medium tracking-[0.25em] text-white/70 uppercase">
            {!coords
              ? 'finding you'
              : !weather
                ? 'reading the sky'
                : 'building your tiny world'}
          </p>
        </div>
      )}

      {/* overlay UI */}
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        {weather && (
          <header className="mw-rise flex flex-col items-center pt-[max(3rem,env(safe-area-inset-top))]">
            <h1
              className="text-[13px] font-semibold tracking-[0.3em] text-white/85 uppercase"
              style={{ textShadow: '0 1px 12px rgba(0,0,0,0.25)' }}
            >
              {place || ' '}
            </h1>
            <div
              className="mt-1 text-[72px] leading-none font-extralight text-white"
              style={{ textShadow: '0 2px 24px rgba(0,0,0,0.25)' }}
            >
              {weather.temperature}°
            </div>
            <p
              className="mt-1 text-[15px] font-medium text-white/80"
              style={{ textShadow: '0 1px 10px rgba(0,0,0,0.3)' }}
            >
              {weather.description}
            </p>
          </header>
        )}

        <footer className="mt-auto flex flex-col items-center gap-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <CityBar active={city} onPick={setCity} />
          <div className="flex w-full items-end justify-between px-6">
            <p className="text-[13px] font-medium text-white/60">
              {weather ? `feels like ${weather.feelsLike}°` : ''}
            </p>
            <SoundButton weather={weather} />
          </div>
        </footer>
      </div>

      {/* world failed but weather works: keep it graceful */}
      {weather && worldError && !world && (
        <button
          onClick={() => setRetryTick((t) => t + 1)}
          className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full bg-white/12 px-4
                     py-2 text-xs text-white/70 backdrop-blur-md transition hover:bg-white/22"
        >
          the map of this place is shy — tap to try again
        </button>
      )}
    </div>
  )
}
