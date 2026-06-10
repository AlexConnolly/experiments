import type { Condition } from './types'

/**
 * Procedural ambience synthesised with the Web Audio API — no audio assets.
 * Each condition builds a small node graph; switching crossfades via the
 * layer gain. Everything hangs off one master gain for mute/unmute.
 */
export class Ambience {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private layer: GainNode | null = null
  private stops: (() => void)[] = []
  private current: string | null = null
  private wanted: { condition: Condition; isDay: boolean } | null = null
  enabled = false

  setWeather(condition: Condition, isDay: boolean) {
    this.wanted = { condition, isDay }
    if (this.enabled) this.apply()
  }

  toggle(): boolean {
    this.enabled = !this.enabled
    if (this.enabled) {
      this.ensureContext()
      this.apply()
      this.ramp(this.master!, 1, 1.5)
    } else if (this.master && this.ctx) {
      this.ramp(this.master, 0, 0.6)
    }
    return this.enabled
  }

  private ensureContext() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(this.ctx.destination)
  }

  private ramp(node: GainNode, target: number, seconds: number) {
    const t = this.ctx!.currentTime
    node.gain.cancelScheduledValues(t)
    node.gain.setValueAtTime(node.gain.value, t)
    node.gain.linearRampToValueAtTime(target, t + seconds)
  }

  private apply() {
    if (!this.ctx || !this.master || !this.wanted) return
    const key = `${this.wanted.condition}/${this.wanted.isDay}`
    if (key === this.current) return
    this.current = key

    // fade out + tear down the previous layer
    if (this.layer) {
      const old = this.layer
      this.ramp(old, 0, 1.2)
      const oldStops = this.stops
      setTimeout(() => {
        oldStops.forEach((s) => s())
        old.disconnect()
      }, 1500)
    }
    this.stops = []
    this.layer = this.ctx.createGain()
    this.layer.gain.value = 0
    this.layer.connect(this.master)
    this.ramp(this.layer, 1, 2)

    const { condition, isDay } = this.wanted
    switch (condition) {
      case 'rain':
        this.rain(0.5, 1400)
        break
      case 'drizzle':
        this.rain(0.3, 1000)
        break
      case 'thunder':
        this.rain(0.55, 1200)
        this.thunder()
        break
      case 'snow':
        this.wind(0.16, 280, 0.05)
        break
      case 'fog':
        this.wind(0.14, 220, 0.03)
        break
      case 'cloudy':
        this.wind(0.2, 380, 0.08)
        if (isDay) this.birds(7)
        break
      default:
        // clear / partly
        this.wind(0.12, 450, 0.1)
        if (isDay) this.birds(3.5)
        else this.crickets()
    }
  }

  private noiseSource(): AudioBufferSourceNode {
    const ctx = this.ctx!
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    return src
  }

  private rain(level: number, tone: number) {
    const ctx = this.ctx!
    const src = this.noiseSource()
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = tone
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 250
    const gain = ctx.createGain()
    gain.gain.value = level
    // slow shimmer so the rain feels alive
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.09
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = tone * 0.25
    lfo.connect(lfoGain).connect(lp.frequency)
    src.connect(hp).connect(lp).connect(gain).connect(this.layer!)
    src.start()
    lfo.start()
    this.stops.push(() => {
      src.stop()
      lfo.stop()
    })
  }

  private wind(level: number, tone: number, sway: number) {
    const ctx = this.ctx!
    const src = this.noiseSource()
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = tone
    bp.Q.value = 0.6
    const gain = ctx.createGain()
    gain.gain.value = level
    const lfo = ctx.createOscillator()
    lfo.frequency.value = sway
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = tone * 0.6
    lfo.connect(lfoGain).connect(bp.frequency)
    const lfo2 = ctx.createOscillator()
    lfo2.frequency.value = sway * 1.7
    const lfo2Gain = ctx.createGain()
    lfo2Gain.gain.value = level * 0.4
    lfo2.connect(lfo2Gain).connect(gain.gain)
    src.connect(bp).connect(gain).connect(this.layer!)
    src.start()
    lfo.start()
    lfo2.start()
    this.stops.push(() => {
      src.stop()
      lfo.stop()
      lfo2.stop()
    })
  }

  private birds(meanGap: number) {
    const ctx = this.ctx!
    const layer = this.layer!
    let alive = true
    const chirp = () => {
      if (!alive) return
      const t0 = ctx.currentTime + 0.05
      const notes = 2 + Math.floor(Math.random() * 4)
      const base = 2200 + Math.random() * 1800
      for (let i = 0; i < notes; i++) {
        const t = t0 + i * (0.09 + Math.random() * 0.06)
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        const f = base * (0.9 + Math.random() * 0.3)
        osc.frequency.setValueAtTime(f, t)
        osc.frequency.exponentialRampToValueAtTime(f * 1.4, t + 0.04)
        osc.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.09)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.045, t + 0.015)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
        osc.connect(g).connect(layer)
        osc.start(t)
        osc.stop(t + 0.12)
      }
      setTimeout(chirp, (meanGap * 0.5 + Math.random() * meanGap) * 1000)
    }
    chirp()
    this.stops.push(() => {
      alive = false
    })
  }

  private crickets() {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = 4300
    const gain = ctx.createGain()
    gain.gain.value = 0
    const pulse = ctx.createOscillator()
    pulse.type = 'square'
    pulse.frequency.value = 19
    const pulseGain = ctx.createGain()
    pulseGain.gain.value = 0.012
    pulse.connect(pulseGain).connect(gain.gain)
    const slow = ctx.createOscillator()
    slow.frequency.value = 0.7
    const slowGain = ctx.createGain()
    slowGain.gain.value = 0.012
    slow.connect(slowGain).connect(gain.gain)
    osc.connect(gain).connect(this.layer!)
    osc.start()
    pulse.start()
    slow.start()
    this.stops.push(() => {
      osc.stop()
      pulse.stop()
      slow.stop()
    })
  }

  private thunder() {
    const ctx = this.ctx!
    const layer = this.layer!
    let alive = true
    const rumble = () => {
      if (!alive) return
      const src = this.noiseSource()
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 90 + Math.random() * 60
      const g = ctx.createGain()
      const t = ctx.currentTime
      const dur = 2.5 + Math.random() * 2.5
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.55 + Math.random() * 0.25, t + 0.15)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      src.connect(lp).connect(g).connect(layer)
      src.start()
      src.stop(t + dur + 0.1)
      setTimeout(rumble, (7 + Math.random() * 14) * 1000)
    }
    setTimeout(rumble, 2500)
    this.stops.push(() => {
      alive = false
    })
  }
}

export const ambience = new Ambience()
