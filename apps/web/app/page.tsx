import { SPORTS, type SnapshotMessage } from '@liveline/protocol';
import { Board } from '@/components/Board';
import { ConnectionBadge } from '@/components/ConnectionBadge';
import { SportTabs } from '@/components/SportTabs';
import { GATEWAY_HTTP_URL } from '@/lib/config';
import { sportName } from '@/lib/format';

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

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string }>;
}) {
  const requested = Number((await searchParams).sport);
  const sportId = SPORTS.some((s) => s.id === requested) ? requested : 1;
  const snapshot = await loadSnapshot(sportId);

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
            <span className="muted">{snapshot ? `${snapshot.events.length} events` : ''}</span>
          </div>
          <Board key={sportId} sportId={sportId} initial={snapshot} />
        </section>
        <aside className="side" />
      </main>
    </>
  );
}
