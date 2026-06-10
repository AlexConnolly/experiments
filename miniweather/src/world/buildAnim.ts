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
  shader.vertexShader =
    'attribute float aDelay;\nattribute float aGround;\nuniform float uBuild;\n' +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float bT = clamp((uBuild - aDelay) / 0.9, 0.0, 1.0);
      float bS = 1.0 + 2.70158 * pow(bT - 1.0, 3.0) + 1.70158 * pow(bT - 1.0, 2.0);
      transformed.y = aGround + (transformed.y - aGround) * bS;`,
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
