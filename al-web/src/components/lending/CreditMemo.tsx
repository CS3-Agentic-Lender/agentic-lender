interface MemoSection {
  heading: string | null;
  body: string;
}

// The strategist stores the memo as one text, each section a "## heading" line and then its text (al-ai's render_memo).
// The headings are read from the text, not listed here, so the portal shows whatever was stored and hashed.
function memoSections(memo: string): MemoSection[] {
  const sections: MemoSection[] = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };
  const close = () => {
    const body = current.lines.join('\n').trim();
    if (current.heading !== null || body) sections.push({ heading: current.heading, body });
  };
  for (const line of memo.split(/\r?\n/)) {
    const heading = /^##\s+(\S.*)$/.exec(line);
    if (heading) {
      close();
      current = { heading: heading[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  close();
  return sections;
}

export function CreditMemo({ memo, headingLevel = 4 }: { memo: string; headingLevel?: 4 | 5 }) {
  const sections = memoSections(memo);
  // A memo with no headings (an older or hand-written one) stays exactly as stored.
  if (!sections.some((section) => section.heading !== null)) {
    return <p className="mt-3 whitespace-pre-wrap break-words leading-7">{memo}</p>;
  }
  const Heading = headingLevel === 4 ? 'h4' : 'h5';
  return (
    <>
      {sections.map((section, index) => (
        <div className="mt-4" key={index}>
          {section.heading === null ? null : <Heading className="font-semibold">{section.heading}</Heading>}
          <p className="mt-1 whitespace-pre-wrap break-words leading-7">{section.body}</p>
        </div>
      ))}
    </>
  );
}
