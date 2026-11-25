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

// Runs `start` once the host is near the screen and the browser is idle, so a scene never competes with the
// page's own first paint. Returns a cancel function.
export function startWhenNearAndIdle(host: Element, start: () => void) {
  // Older Safari has no requestIdleCallback.
  const idleSupported = typeof (window as Partial<Window>).requestIdleCallback === 'function';
  let idle = 0;
  const near = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    near.disconnect();
    idle = idleSupported ? window.requestIdleCallback(start, { timeout: 1000 }) : window.setTimeout(start, 200);
  }, { rootMargin: '200px' });
  near.observe(host);
  return () => {
    near.disconnect();
    if (idleSupported) window.cancelIdleCallback(idle);
    else window.clearTimeout(idle);
  };
}

export function readToken(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
