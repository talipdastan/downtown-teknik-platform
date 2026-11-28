import Link from 'next/link';
import { Compass, Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-navy/10 text-navy">
          <Compass className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-extrabold text-slate-900">
          Sayfa bulunamadı (404)
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Aradığınız sayfa taşınmış veya adres hatalı girilmiş olabilir.
        </p>
        <Link
          href="/home"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-xs font-bold text-white hover:bg-navy-hover"
        >
          <Home className="h-4 w-4" />
          Modül Seçimine Dön
        </Link>
      </div>
    </div>
  );
}
