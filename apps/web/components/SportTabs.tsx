import { SPORTS } from '@liveline/protocol';
import Link from 'next/link';
import { SportCount } from './SportCount';

export function SportTabs({
  active,
  counts,
}: {
  active: number;
  /** Events per sport id from the server render; null when the gateway did not answer. */
  counts: Record<string, number> | null;
}) {
  return (
    <nav className="tabs" aria-label="Sports">
      {SPORTS.map((sport) => (
        <Link
          key={sport.id}
          href={`/?sport=${sport.id}`}
          className="tab"
          aria-current={sport.id === active ? 'page' : undefined}
          scroll={false}
        >
          {sport.name} <SportCount sportId={sport.id} initial={counts?.[sport.id]} />
        </Link>
      ))}
    </nav>
  );
}
