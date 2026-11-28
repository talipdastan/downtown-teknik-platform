'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Hata ayrıntısı geliştirme konsolunda kalır, kullanıcıya temiz Türkçe mesaj gösterilir.
  }, [error]);

  return (
    <html lang="tr">
      <body className="flex min-h-screen items-center justify-center bg-slate-50 p-6 font-sans text-slate-900">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-extrabold text-slate-900">
            Beklenmeyen bir uygulama hatası oluştu
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {error?.message || 'Sayfa yüklenirken teknik bir sorun yaşandı.'}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#17365D] px-4 py-2.5 text-sm font-bold text-white hover:opacity-95"
          >
            <RotateCcw className="h-4 w-4" />
            Sayfayı Yeniden Dene
          </button>
        </div>
      </body>
    </html>
  );
}
