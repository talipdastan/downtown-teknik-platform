'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/core/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      let email = identifier.trim();

      if (!email.includes('@')) {
        const { data, error: rpcErr } = await supabase.rpc(
          'rpc_resolve_login_email',
          { p_identifier: email }
        );
        if (rpcErr) throw rpcErr;
        email = data ? String(data) : '';
      }

      if (!email) {
        setError('Kullanıcı bulunamadı.');
        return;
      }

      const { data: authData, error: signInErr } =
        await supabase.auth.signInWithPassword({ email, password });

      if (signInErr || !authData.user) {
        setError(signInErr?.message ?? 'Giriş başarısız.');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('approval_status')
        .eq('id', authData.user.id)
        .single();

      if (profile?.approval_status === 'approved') {
        router.push('/home');
      } else {
        router.push('/pending');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Beklenmeyen bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src="/downtown-teknik-logo.png"
            alt="Downtown Teknik – Teknik Operasyon Yönetim Platformu"
            className="h-auto w-full max-w-[310px] object-contain"
          />
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              E-posta, Ad Soyad veya Telefon
            </label>
            <input
              type="text"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-navy focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Parola
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-navy focus:outline-none"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-navy-hover disabled:opacity-60"
          >
            {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
          </button>
        </form>

        <div className="mt-6 border-t border-slate-100 pt-4 text-center">
          <a
            href="/download"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-turquoise/40 bg-turquoise-soft/50 px-4 py-2.5 text-xs font-extrabold text-turquoise transition hover:bg-turquoise-soft"
          >
            <span>📱 Android APK İndir / Telefona Uygulama Olarak Yükle</span>
          </a>
        </div>
      </div>
    </main>
  );
}
