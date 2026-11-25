// Where focus goes when the control that had it is gone, such as a deleted row's button or a request that left the
// list: the page's heading, so a keyboard or screen reader user carries on from the top of the page, not the body.
export function focusPageHeading() {
  const heading = document.querySelector<HTMLElement>('main h1');
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
  heading.focus();
}

export function focusWasLost() {
  return document.activeElement === null || document.activeElement === document.body;
}
