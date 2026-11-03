'use client';

import { useEffect, useState } from 'react';
import { useFeed } from '@/lib/hooks';

export function ConnectionBadge() {
  const feed = useFeed();
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => feed?.onMetrics((m) => setConnected(m.connected)), [feed]);
  const label = connected === null ? 'connecting' : connected ? 'live' : 'offline';
  return (
    <span className="conn" data-state={label}>
      <span className="conn-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
