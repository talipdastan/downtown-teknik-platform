import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const PROTECTED_PREFIXES = [
  '/home',
  '/energy',
  '/work-tracking',
  '/admin',
  '/maintenance',
  '/inventory',
  '/shifts',
  '/contracts',
];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request: { headers: request.headers },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // nginx arkasında request.nextUrl.origin `http://localhost:3000` olarak gelir;
    // gerçek Host ve X-Forwarded-Proto başlıklarından mutlak yönlendirme URL'si üretilir.
    const proto = request.headers.get('x-forwarded-proto') || 'http';
    const host =
      request.headers.get('x-forwarded-host') || request.headers.get('host');
    const baseUrl = host ? `${proto}://${host}` : request.nextUrl.origin;
    const loginUrl = new URL('/login', baseUrl);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/home/:path*',
    '/energy/:path*',
    '/work-tracking/:path*',
    '/admin/:path*',
    '/maintenance/:path*',
    '/inventory/:path*',
    '/shifts/:path*',
    '/contracts/:path*',
  ],
};
