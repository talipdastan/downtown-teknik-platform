// ===================================================================
// SUPABASE EDGE FUNCTION: send-push-notification
// PROJECT: AVM TECH – Modüler Teknik Operasyon Platformu
// DESCRIPTION: Sunucu taraflı Firebase Cloud Messaging (FCM HTTP v1) Push Bildirim Servisi
// GÜVENLİK: Gizli anahtarlar yalnızca sunucu ortam değişkenlerinden (Deno.env) okunur.
// ===================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface WebhookPayload {
  type?: 'INSERT';
  table?: string;
  record?: {
    id: string;
    user_id: string;
    module_key?: string | null;
    entity_type?: string | null;
    entity_id?: string | null;
    ticket_id?: string | null;
    title: string;
    message: string;
  };
}

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const clean = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getGoogleAccessToken(clientEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(sig))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error('Google OAuth2 token alınamadı: ' + JSON.stringify(tokenData));
  }
  return tokenData.access_token as string;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Sunucu Supabase ortam değişkenleri eksik.' }), { status: 500 });
    }

    const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') || '';
    if (webhookSecret) {
      const providedSecret = req.headers.get('x-webhook-secret') || '';
      const authHeader = req.headers.get('authorization') || '';
      const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;
      if (providedSecret !== webhookSecret && !isServiceRole) {
        return new Response(JSON.stringify({ error: 'Yetkisiz webhook isteği.' }), { status: 401 });
      }
    }

    const payload = (await req.json()) as WebhookPayload;
    const notification = payload.record;
    if (!notification?.user_id || !notification?.title) {
      return new Response(JSON.stringify({ error: 'Geçersiz bildirim verisi.' }), { status: 400 });
    }

    let projectId = Deno.env.get('FCM_PROJECT_ID') || '';
    let clientEmail = Deno.env.get('FCM_CLIENT_EMAIL') || '';
    let privateKey = Deno.env.get('FCM_PRIVATE_KEY') || '';
    let accessToken = Deno.env.get('FCM_ACCESS_TOKEN') || '';

    const saJsonRaw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
    if (saJsonRaw) {
      const sa = JSON.parse(saJsonRaw);
      projectId = projectId || sa.project_id || '';
      clientEmail = clientEmail || sa.client_email || '';
      privateKey = privateKey || sa.private_key || '';
    }

    if (!accessToken && projectId && clientEmail && privateKey) {
      accessToken = await getGoogleAccessToken(clientEmail, privateKey);
    }

    if (!projectId || !accessToken) {
      return new Response(
        JSON.stringify({
          delivered: false,
          inAppSaved: true,
          reason: 'FCM_SERVICE_ACCOUNT_JSON (veya FCM_PROJECT_ID + FCM_ACCESS_TOKEN) tanımlı değil.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, approval_status')
      .eq('id', notification.user_id)
      .single();

    if (!profile || profile.approval_status !== 'approved') {
      return new Response(JSON.stringify({ delivered: false, reason: 'Kullanıcı onaylı değil.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const entityId = notification.entity_id ?? notification.ticket_id ?? '';
    const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          topic: `user_${notification.user_id}`,
          notification: {
            title: notification.title,
            body: notification.message,
          },
          android: {
            priority: 'high',
            notification: {
              channel_id: 'avm_tech_alerts',
              sound: 'default',
            },
          },
          data: {
            notification_id: notification.id,
            module_key: notification.module_key ?? 'system',
            entity_type: notification.entity_type ?? '',
            entity_id: entityId,
            ticket_id: entityId,
          },
        },
      }),
    });

    const fcmBody = await fcmRes.text();
    return new Response(
      JSON.stringify({ delivered: fcmRes.ok, status: fcmRes.status, response: fcmBody }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
