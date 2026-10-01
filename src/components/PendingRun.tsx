'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function PendingRun({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/reports/${id}`, { cache: 'no-store' });
        if (!response.ok) return;
        const data: unknown = await response.json();
        if (data && typeof data === 'object' && 'run' in data && data.run && typeof data.run === 'object' && 'status' in data.run &&
            !['QUEUED', 'RUNNING'].includes(String(data.run.status))) { window.clearInterval(timer); router.refresh(); }
      } catch { /* The persisted run remains available for a later refresh. */ }
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [id, router]);
  return <p role="status">The public website analysis is running. This page will update when its saved result is ready.</p>;
}
