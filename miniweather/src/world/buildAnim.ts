import * as THREE from 'three'

/**
 * Shared clock for the "Lego build-in": geometry carries a per-building
 * `aDelay` attribute and the vertex shader scales height by an
 * ease-out-back of (uBuild - aDelay), so the city pops up in a wave.
 */
export const buildUniform = { value: 0 }

export function resetBuild() {
  buildUniform.value = 0
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export function patchBuildMaterial(shader: { uniforms: Record<string, unknown>; vertexShader: string }) {
  shader.uniforms.uBuild = buildUniform
  // buildings drop into place from above (parked far overhead until their turn)
  shader.vertexShader =
    'attribute float aDelay;\nattribute float aRate;\nuniform float uBuild;\n' +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float bT = clamp((uBuild - aDelay) / max(aRate, 0.2), 0.0, 1.0);
      float eD = 1.0 - pow(1.0 - bT, 3.0);
      transformed.y += (bT <= 0.0) ? 900.0 : (1.0 - eD) * 70.0;`,
    )
}

export const buildCacheKey = () => 'mw-build-anim'

/** Add a constant per-vertex delay attribute to a geometry. */
export function setDelay(geo: THREE.BufferGeometry, delay: number) {
  const count = geo.attributes.position.count
  const arr = new Float32Array(count)
  arr.fill(delay)
  geo.setAttribute('aDelay', new THREE.Float32BufferAttribute(arr, 1))
}

/** Add a per-vertex fall-duration attribute (seconds to settle). */
export function setRate(geo: THREE.BufferGeometry, rate: number) {
  const count = geo.attributes.position.count
  const arr = new Float32Array(count)
  arr.fill(rate)
  geo.setAttribute('aRate', new THREE.Float32BufferAttribute(arr, 1))
}

/** Add a constant per-vertex ground-height attribute (build-anim pivot). */
export function setGround(geo: THREE.BufferGeometry, ground: number) {
  const count = geo.attributes.position.count
  const arr = new Float32Array(count)
  arr.fill(ground)
  geo.setAttribute('aGround', new THREE.Float32BufferAttribute(arr, 1))
}

/** Add a constant per-vertex colour attribute to a geometry. */
export function setColor(geo: THREE.BufferGeometry, color: THREE.Color) {
  const count = geo.attributes.position.count
  const arr = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r
    arr[i * 3 + 1] = color.g
    arr[i * 3 + 2] = color.b
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3))
}
