'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/core/supabase/client';

interface UseDebouncedRealtimeOptions {
  channelName: string;
  tables: string[];
  onRefresh: () => void;
  delayMs?: number;
  refreshOnFocus?: boolean;
  enabled?: boolean;
}

/**
 * Birden fazla tablodan (ör. `tickets` + `work_orders`) aynı milisaniyede gelen
 * Realtime olaylarını tek yenileme isteğinde birleştirir (debounce) ve
 * pencere odağı dönüşünde sessiz tazeleme yapar.
 */
export function useDebouncedRealtime({
  channelName,
  tables,
  onRefresh,
  delayMs = 500,
  refreshOnFocus = true,
  enabled = true,
}: UseDebouncedRealtimeOptions) {
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);
  const tablesKey = tables.join(',');

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refreshRef.current();
      }, delayMs);
    };

    let channel = supabase.channel(channelName);
    for (const table of tablesKey.split(',').filter(Boolean)) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        scheduleRefresh
      );
    }
    channel.subscribe();

    const onFocus = () => {
      if (refreshOnFocus) scheduleRefresh();
    };
    if (refreshOnFocus) {
      window.addEventListener('focus', onFocus);
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (refreshOnFocus) {
        window.removeEventListener('focus', onFocus);
      }
      supabase.removeChannel(channel);
    };
  }, [channelName, tablesKey, delayMs, refreshOnFocus, enabled]);
}
