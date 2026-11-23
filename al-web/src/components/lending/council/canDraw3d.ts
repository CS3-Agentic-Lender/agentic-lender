// A 3D view needs WebGL 2 and the observers it uses to pause off-screen. Where any is missing (old browsers,
// the test environment) the caller leaves the 3D out and the page's text carries everything.
export function canDraw3d() {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window) || !('ResizeObserver' in window)) return false;
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export function readToken(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
