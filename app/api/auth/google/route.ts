import { NextRequest, NextResponse } from 'next/server';
import { getAuthUrl, exchangeCodeForTokens } from '@/lib/sheets';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');

  if (!code) {
    // Redirect to Google OAuth
    const authUrl = getAuthUrl();
    return NextResponse.redirect(authUrl);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    // Return tokens to the client-side via a redirect with fragment
    // In production, store tokens server-side with a session ID
    const redirectUrl = new URL('/', req.url);
    redirectUrl.searchParams.set('access_token', tokens.access_token ?? '');
    redirectUrl.searchParams.set('refresh_token', tokens.refresh_token ?? '');
    return NextResponse.redirect(redirectUrl);
  } catch (err: unknown) {
    return NextResponse.json({ error: 'OAuth failed', message: (err as Error)?.message }, { status: 500 });
  }
}
