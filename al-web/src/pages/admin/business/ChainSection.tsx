import { useMemo } from 'react';
import { Link } from 'react-router';
import { StatTile } from '../../../components/admin/StatTile';
import { SkeletonCard } from '../../../components/Skeleton';
import { explorerTxUrl } from '../../../components/lending/LoanNotePanel';
import type { LiveState } from '../../../hooks/useLive';
import type { LoanFileApplication } from '../../../services/loanFileService';
import { formatDate } from '../../../utils/formatters';
import { plural, RowLink } from './BusinessPage';
import { ChainHash } from './ChainHash';
import { chainFigures, type LedgerFilter, type Mint } from './figures';

const auditHref = (note: LedgerFilter) => `/admin/business/audit?note=${note}`;

function RecentMints({ mints }: { mints: Mint[] }) {
  if (mints.length === 0) {
    return <p className="mt-3 text-muted">No loan notes minted yet.</p>;
  }

  return (
    <ol aria-label="Recent mints" className="mt-3 divide-y divide-line">
      {mints.map(({ application, note }) => (
        <li
          className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 py-3 md:grid-cols-[minmax(0,1fr)_5rem_auto_auto_7rem] md:gap-x-6"
          key={application.id}
        >
          <span className="min-w-0 break-words">
            <RowLink to={`/admin/applications/${encodeURIComponent(application.id)}`}>
              {application.borrowerName ?? 'Name not recorded'}
            </RowLink>
          </span>
          <span className="text-sm text-muted tabular-nums md:text-ink">Token #{note.tokenId}</span>
          <span className="text-sm">
            <span className="text-muted">Mint </span>
            <ChainHash hash={note.txHash} href={explorerTxUrl(note.network, note.txHash)} what="Mint transaction" />
          </span>
          <span className="text-sm">
            <span className="text-muted">Audit </span>
            <ChainHash
              hash={note.auditHash}
              href={explorerTxUrl(note.network, application.auditTxHash)}
              what="Audit hash"
            />
          </span>
          <span className="col-span-2 text-sm text-muted md:col-span-1 md:text-right">
            <span className="md:sr-only">Minted </span>
            {formatDate(note.mintedAt)}
          </span>
        </li>
      ))}
    </ol>
  );
}

// The loan notes and audit hashes, as al-core stored them on each application when it wrote them to the chain.
export function ChainSection({ applications }: { applications: LiveState<LoanFileApplication> }) {
  const items = applications.status === 'ready' ? applications.items : null;
  const chain = useMemo(() => (items ? chainFigures(items) : null), [items]);
  const loading = applications.status === 'loading';
  const waiting = loading ? 'Loading the loan notes.' : 'The applications could not be loaded.';

  return (
    <section aria-labelledby="business-chain" className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="card-title" id="business-chain">
          Blockchain
        </h2>
        <Link className="text-sm font-semibold text-pine underline-offset-4 hover:underline" to="/admin/business/audit">
          Audit trail
        </Link>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3 sm:gap-5">
        <StatTile
          detail={
            chain === null
              ? waiting
              : chain.recent.length === 0
                ? 'None minted yet.'
                : `Latest on ${formatDate(chain.recent[0].note.mintedAt)}.`
          }
          label="Loan notes minted"
          loading={loading}
          to={auditHref('minted')}
          value={chain?.minted ?? null}
        />
        <StatTile
          detail={chain ? `${chain.open} still open.` : waiting}
          label="Loan notes closed"
          loading={loading}
          to={auditHref('closed')}
          value={chain?.closed ?? null}
        />
        <StatTile
          detail={chain ? `In the audit registry, for ${chain.recorded} of ${plural(chain.minted, 'minted loan')}.` : waiting}
          label="Audit hashes recorded"
          loading={loading}
          to={auditHref('recorded')}
          value={chain?.recorded ?? null}
        />
      </div>
      {chain ? (
        <section aria-labelledby="business-mints" className="card mt-5">
          <h3 className="card-title" id="business-mints">
            Recent mints
          </h3>
          <p className="mt-1 text-sm text-muted">The latest loan notes, with their mint transaction and audit hash.</p>
          <RecentMints mints={chain.recent} />
        </section>
      ) : loading ? (
        <SkeletonCard className="mt-5" rows={3} />
      ) : null}
    </section>
  );
}
