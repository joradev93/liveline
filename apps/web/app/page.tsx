import { SPORTS, type SnapshotMessage } from '@liveline/protocol';
import { Board } from '@/components/Board';
import { ConnectionBadge } from '@/components/ConnectionBadge';
import { SidePanel } from '@/components/SidePanel';
import { SportTabs } from '@/components/SportTabs';
import { GATEWAY_HTTP_URL } from '@/lib/config';
import { sportName } from '@/lib/format';
import { createSnapshotCache } from '@/lib/snapshot-cache';

async function loadSnapshot(sportId: number): Promise<SnapshotMessage | null> {
  try {
    const res = await fetch(`${GATEWAY_HTTP_URL}/snapshot/sport:${sportId}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1_500),
    });
    return res.ok ? ((await res.json()) as SnapshotMessage) : null;
  } catch {
    // Gateway down: render the shell; the client connects when it is back.
    return null;
  }
}

// Module scope: shared by all requests this server process handles.
const getSnapshot = createSnapshotCache(loadSnapshot, 1_000);

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string }>;
}) {
  const requested = Number((await searchParams).sport);
  const sportId = SPORTS.some((s) => s.id === requested) ? requested : 1;
  // Not streamed behind <Suspense>: measured, that paints the shell earlier but the rows (the
  // phone LCP element) ~270 ms later, because React delays the reveal of streamed content.
  const first = await getSnapshot(sportId);

  return (
    <>
      <header className="top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Liveline
        </div>
        <SportTabs active={sportId} />
        <ConnectionBadge />
      </header>
      <main className="layout">
        <section className="board" aria-label={`${sportName(sportId)} events`}>
          <div className="board-head">
            <h1>{sportName(sportId)}</h1>
            <span className="muted">{first ? `${first.total} events` : ''}</span>
          </div>
          <p className="lead">
            Live odds from a synthetic feed, pushed over WebSocket and coalesced every 100 ms. Click
            a price to add it to the betslip, or a match to see all its markets.
          </p>
          <Board key={sportId} sportId={sportId} initial={first?.snapshot ?? null} />
        </section>
        <SidePanel />
      </main>
    </>
  );
}
