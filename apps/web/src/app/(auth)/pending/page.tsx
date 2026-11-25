'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/core/supabase/client';

export default function PendingPage() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-navy">Yönetici Onayı Bekleniyor</h1>
        <p className="mt-2 text-sm text-slate-600">
          Hesabınız oluşturuldu ancak henüz onaylanmadı. Sistem Yöneticisi
          hesabınızı onayladıktan sonra yetkili olduğunuz modüllere erişebilirsiniz.
        </p>
        <button
          onClick={handleSignOut}
          className="mt-6 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Çıkış Yap
        </button>
      </div>
    </main>
  );
}
