export function Mark({ light = false }: { light?: boolean }) {
  return (
    <span className={`brand ${light ? 'brand-light' : ''}`}>
      <span className="brand-glyph" aria-hidden="true"><span /></span>
      <span>agentic<span className="brand-secondary">lender</span></span>
    </span>
  );
}
