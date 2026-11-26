'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';

type VersionMeta = {
  version: string;
  buildNumber: number;
  releaseDate: string;
  apkUrl: string;
  mandatory?: boolean;
  releaseNotes?: string[];
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function MobileDownloadPage() {
  const [meta, setMeta] = useState<VersionMeta | null>(null);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [pwaInstalled, setPwaInstalled] = useState(false);
  const [originUrl, setOriginUrl] = useState('http://10.16.19.19');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOriginUrl(window.location.origin);
    }
    fetch('/download/version.json', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: VersionMeta) => setMeta(d))
      .catch(() => {});

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstallPwa() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setPwaInstalled(true);
      setDeferredPrompt(null);
    }
  }

  const apkDirectUrl = `${originUrl}/download/downtown-teknik.apk`;
  const qrImageSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(
    apkDirectUrl
  )}`;

  return (
    <main className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Üst Gezinme */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4 text-navy" />
            Giriş Ekranına Dön
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-turquoise-soft px-3.5 py-1 text-xs font-extrabold text-turquoise">
            <RefreshCw className="h-3.5 w-3.5" />
            Otomatik Güncelleme (OTA + PWA) Aktif
          </span>
        </div>

        {/* Hero Kartı */}
        <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#0F2342] via-navy to-[#1E4474] p-6 text-white shadow-lg sm:p-8">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-cyan-300">
                <Sparkles className="h-3.5 w-3.5" />
                KURUMSAL MOBİL DAĞITIM MERKEZİ
              </div>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                Downtown Teknik Mobil Uygulama
              </h1>
              <p className="max-w-xl text-sm text-slate-200">
                Google Play Store beklemelerine gerek kalmadan en güncel Android
                APK paketini doğrudan sunucumuzdan indirin veya iPhone / Android
                cihazınızda <strong>Web Uygulaması (PWA)</strong> olarak ana
                ekranınıza ekleyin.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1 text-xs font-bold text-cyan-200">
                <span>
                  Güncel Sürüm: v{meta?.version ?? '1.2.0'} (Yapı #
                  {meta?.buildNumber ?? 3})
                </span>
                <span>•</span>
                <span>Uygulama İçi Otomatik Güncelleme Destekli</span>
              </div>
            </div>

            {/* QR Kod Kutusu */}
            <div className="flex flex-col items-center rounded-2xl bg-white p-3.5 text-center text-slate-800 shadow-md">
              <img
                src={qrImageSrc}
                alt="APK İndirme QR Kodu"
                className="h-36 w-36 rounded-lg object-contain"
              />
              <span className="mt-2 text-[11px] font-extrabold text-navy">
                Telefon Kamerasıyla Okutun
              </span>
              <span className="text-[10px] text-slate-500">
                Doğrudan APK İndirir
              </span>
            </div>
          </div>
        </div>

        {/* İki Seçenek: 1) Android APK (OTA Güncellemeli) | 2) PWA (Anında Güncellenen Web App) */}
        <div className="grid gap-5 md:grid-cols-2">
          {/* Seçenek 1: Android APK */}
          <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-navy-soft px-3 py-1 text-xs font-extrabold text-navy">
                  <Smartphone className="h-4 w-4" />
                  1. SEÇENEK · ANDROID APK (OTA)
                </span>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-800">
                  Önerilen (Android)
                </span>
              </div>

              <h2 className="text-lg font-extrabold text-slate-900">
                Otomatik Güncellenen Android APK
              </h2>
              <p className="text-xs leading-relaxed text-slate-600">
                Uygulamayı telefonunuza bir kez kurmanız yeterlidir. Yeni bir
                güncelleme yayınlandığında uygulama açılışta bunu otomatik tespit
                eder ve <strong>&ldquo;Yeni Sürüm Mevcut – Şimdi Güncelle&rdquo;</strong>{' '}
                butonuyla sizi bilgilendirir.
              </p>

              <ul className="space-y-2 text-xs text-slate-700">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>Kamera, galeri, bildirim ve çevrimdışı (offline) kayıt</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>Uygulama içinden tek tuşla yeni sürüme yükseltme</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-navy" />
                  <span>Doğrudan şirket sunucusundan güvenli kurulum</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 space-y-2">
              <a
                href="/download/downtown-teknik.apk"
                download="downtown-teknik.apk"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy px-4 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-navy-hover"
              >
                <Download className="h-4 w-4" />
                Android APK İndir (v{meta?.version ?? '1.2.0'})
              </a>
              <p className="text-center text-[11px] text-slate-400">
                Doğrudan bağlantı: {apkDirectUrl}
              </p>
            </div>
          </div>

          {/* Seçenek 2: PWA (Android & iPhone) */}
          <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-turquoise-soft px-3 py-1 text-xs font-extrabold text-turquoise">
                  <RefreshCw className="h-4 w-4" />
                  2. SEÇENEK · WEB UYGULAMASI (PWA)
                </span>
                <span className="rounded-full bg-cyan-100 px-2.5 py-0.5 text-[11px] font-extrabold text-cyan-900">
                  iPhone (iOS) & Android
                </span>
              </div>

              <h2 className="text-lg font-extrabold text-slate-900">
                APK Kurmadan Ana Ekrana Ekle (Anında Güncel)
              </h2>
              <p className="text-xs leading-relaxed text-slate-600">
                Hiçbir dosya indirmeden telefonunuzun ana ekranına{' '}
                <strong>Downtown Teknik</strong> ikonu ekler. Tam ekran uygulama
                gibi açılır ve sunucuda yapılan her değişiklik{' '}
                <strong>aynı saniyede otomatik</strong> yansır.
              </p>

              <div className="space-y-2 rounded-xl border border-slate-100 bg-canvas p-3.5 text-xs text-slate-700">
                <div className="font-extrabold text-navy">
                  Nasıl Kurulur? (10 Saniye)
                </div>
                <div>
                  <strong>• Android (Chrome):</strong> Aşağıdaki{' '}
                  <em>&ldquo;Ana Ekrana Uygulama Olarak Yükle&rdquo;</em> butonuna
                  basın veya sağ üstteki <strong>⋮</strong> menüsünden{' '}
                  <strong>&ldquo;Ana ekrana ekle / Uygulamayı yükle&rdquo;</strong>{' '}
                  seçeneğine dokunun.
                </div>
                <div>
                  <strong>• iPhone / iPad (Safari):</strong> Alt ortadaki{' '}
                  <strong>Paylaş (↑)</strong> butonuna dokunun ve{' '}
                  <strong>&ldquo;Ana Ekrana Ekle&rdquo;</strong> seçeneğini seçin.
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              {deferredPrompt ? (
                <button
                  type="button"
                  onClick={handleInstallPwa}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-turquoise px-4 py-3 text-sm font-extrabold text-white shadow-sm transition hover:opacity-95"
                >
                  <Smartphone className="h-4 w-4" />
                  Ana Ekrana Uygulama Olarak Yükle
                </button>
              ) : (
                <Link
                  href="/home"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-turquoise bg-turquoise-soft/60 px-4 py-2.5 text-sm font-extrabold text-turquoise transition hover:bg-turquoise-soft"
                >
                  <Smartphone className="h-4 w-4" />
                  {pwaInstalled
                    ? 'Uygulama Yüklendi – Panele Git'
                    : 'Web Uygulamasını Aç (Tarayıcı Menüden Ana Ekrana Ekleyin)'}
                </Link>
              )}
              <p className="text-center text-[11px] text-slate-400">
                Sıfır kurulum paketi · Her zaman %100 güncel sürüm
              </p>
            </div>
          </div>
        </div>

        {/* Sürüm Notları */}
        {meta?.releaseNotes && meta.releaseNotes.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-navy">
              Son Sürüm Yenilikleri (v{meta.version})
            </h3>
            <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
              {meta.releaseNotes.map((note, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-0.5 text-turquoise">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
