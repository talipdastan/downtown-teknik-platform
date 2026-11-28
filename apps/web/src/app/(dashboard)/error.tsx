'use client';

import Link from 'next/link';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto my-12 max-w-lg rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-lg font-extrabold text-slate-900">
        Bu modül yüklenirken bir hata oluştu
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        {error?.message || 'Veri alınırken veya ekran çizilirken beklenmeyen bir sorun oluştu.'}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-hover"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Yeniden Dene
        </button>
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-canvas px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
        >
          <Home className="h-3.5 w-3.5" />
          Modül Seçimi
        </Link>
      </div>
    </div>
  );
}
