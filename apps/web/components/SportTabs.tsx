import { SPORTS } from '@liveline/protocol';
import Link from 'next/link';

export function SportTabs({ active }: { active: number }) {
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
          {sport.name}
        </Link>
      ))}
    </nav>
  );
}
