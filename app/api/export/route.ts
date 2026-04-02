import { NextRequest, NextResponse } from 'next/server';
import { exportToSheets } from '@/lib/sheets';
import type { Job } from '@/types/job';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobs, keywords, accessToken, refreshToken } = body as {
      jobs: Job[];
      keywords: string;
      accessToken: string;
      refreshToken?: string;
    };

    if (!accessToken) {
      return NextResponse.json({ error: 'No access token provided' }, { status: 401 });
    }

    const result = await exportToSheets(jobs, keywords, accessToken, refreshToken);

    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: 'Export failed', message: (err as Error)?.message },
      { status: 500 }
    );
  }
}
