import { renderToStaticMarkup } from 'react-dom/server';
import { matchRoutes, MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from './routes';

function renderRoute(pathname: string) {
  const matches = matchRoutes(appRoutes, pathname);
  const element = matches?.at(-1)?.route.element;

  if (!element) {
    throw new Error(`No route element matched ${pathname}`);
  }

  return renderToStaticMarkup(<MemoryRouter initialEntries={[pathname]}>{element}</MemoryRouter>);
}

describe('scaffold routes', () => {
  it.each([
    ['/', 'Portal access'],
    ['/login', 'Portal access'],
    ['/portal', 'Portal foundation'],
  ])('renders the %s placeholder', (pathname, heading) => {
    expect(renderRoute(pathname)).toContain(heading);
  });

  it('renders a not-found message for an unknown route', () => {
    expect(renderRoute('/not-a-route')).toContain('Page not found');
  });

  it('keeps the public route table limited to scaffold behavior', () => {
    expect(appRoutes.map((route) => route.path)).toEqual(['/', '/login', '/portal', '*']);
  });
});
