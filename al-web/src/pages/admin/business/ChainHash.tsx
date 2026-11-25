import { shortHash } from '../../../components/lending/LoanNotePanel';

// A hash from the chain, shortened, with the full value on hover. It links to its Polygonscan page only
// when the caller has one (explorerTxUrl builds it for a well-formed hash on Amoy), otherwise it stays text.
export function ChainHash({ hash, href, what }: { hash: string; href: string | undefined; what: string }) {
  const short = shortHash(hash);

  return href ? (
    <a
      aria-label={`${what} ${short} on Polygonscan (opens in a new tab)`}
      className="font-mono text-sm whitespace-nowrap text-pine underline underline-offset-4 hover:opacity-80"
      href={href}
      rel="noreferrer"
      target="_blank"
      title={hash}
    >
      {short}
    </a>
  ) : (
    <span className="font-mono text-sm whitespace-nowrap" title={hash}>
      {short}
    </span>
  );
}
