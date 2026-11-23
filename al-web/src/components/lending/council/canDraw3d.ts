// A 3D view needs WebGL 2 and the observers it uses to pause off-screen. Where any is missing (old browsers,
// the test environment) the caller leaves the 3D out and the page's text carries everything.
let cached: boolean | undefined;

export function canDraw3d() {
  if (cached !== undefined) return cached;
  if (typeof window === 'undefined' || !('IntersectionObserver' in window) || !('ResizeObserver' in window)) return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    // The probe context is released at once so repeated mounts do not use up the browser's context limit.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    cached = gl !== null;
  } catch {
    cached = false;
  }
  return cached;
}

export function readToken(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
