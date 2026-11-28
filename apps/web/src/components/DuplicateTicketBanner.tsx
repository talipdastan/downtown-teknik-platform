'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatDateTime, TICKET_STATUS_LABELS } from '@/core/constants';
import {
  DuplicateOpenTicket,
  findDuplicateOpenTickets,
} from '@/features/work-tracking/queries';

/**
 * Aynı ekipman veya mahal için son 24 saatte açılmış aktif bir arıza varsa
 * mükerrer kayıt oluşturmadan önce sarı uyarı şeridi gösterir.
 */
export function DuplicateTicketBanner({
  equipmentId,
  locationId,
}: {
  equipmentId?: string | null;
  locationId?: string | null;
}) {
  const [duplicates, setDuplicates] = useState<DuplicateOpenTicket[]>([]);

  useEffect(() => {
    const eq = equipmentId?.trim() || null;
    const loc = locationId?.trim() || null;
    if (!eq && !loc) {
      setDuplicates([]);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const list = await findDuplicateOpenTickets({
          equipmentId: eq,
          locationId: loc,
        });
        if (!active) return;
        setDuplicates(list);
      } catch {
        // Migration 0020 henüz uygulanmadıysa sessiz geç
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [equipmentId, locationId]);

  if (duplicates.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
      <div className="flex items-center gap-1.5 font-extrabold text-amber-900">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        Mükerrer Arıza Uyarısı (Son 24 Saat)
      </div>
      <p className="mt-1 text-amber-800">
        Seçili mahal veya ekipman için hâlihazırda açık {duplicates.length} kayıt bulunuyor:
      </p>
      <ul className="mt-1.5 space-y-1">
        {duplicates.map((d) => (
          <li key={d.id} className="rounded-lg bg-white/80 px-2.5 py-1 text-[11px]">
            <strong className="text-navy">{d.ticket_number ?? 'Açık Kayıt'}</strong>{' '}
            <span className="text-slate-500">
              ({TICKET_STATUS_LABELS[d.status] ?? d.status} · {formatDateTime(d.created_at)})
            </span>
            : {d.description.slice(0, 90)}
          </li>
        ))}
      </ul>
    </div>
  );
}
