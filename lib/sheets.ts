import { google } from 'googleapis';
import type { Job } from '@/types/job';
import { format } from 'date-fns';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function exportToSheets(
  jobs: Job[],
  searchKeywords: string,
  accessToken: string,
  refreshToken?: string
): Promise<{ spreadsheetUrl: string; sheetName: string }> {
  const client = getOAuthClient();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const sheets = google.sheets({ version: 'v4', auth: client });

  // Sheet name: "Marketing Manager – Toronto – Apr 2 2026"
  const today = format(new Date(), 'MMM d yyyy');
  const sheetName = `${searchKeywords.slice(0, 40)} – Toronto – ${today}`;

  // Create new spreadsheet
  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: sheetName },
      sheets: [{ properties: { title: 'Jobs' } }],
    },
  });

  const spreadsheetId = spreadsheet.data.spreadsheetId!;

  // Build header row
  const headers = [
    'Job Title',
    'Company',
    'Location',
    'Work Type',
    'Salary (Display)',
    'Salary Min (CAD)',
    'Salary Max (CAD)',
    'Commission / Bonus',
    'Commission Note',
    'Yrs Experience',
    'Employment Type',
    'Date Posted',
    'Source',
    'Link',
  ];

  const rows: (string | number | null)[][] = jobs.map((job) => [
    job.title,
    job.company,
    job.location,
    job.workType,
    job.salaryDisplay,
    job.salary?.min ?? '',
    job.salary?.max ?? '',
    job.hasCommission ? 'Yes' : 'No',
    job.salary?.commissionNote ?? '',
    job.yearsExperience !== null ? job.yearsExperience : 'Not specified',
    job.employmentType ?? 'Not specified',
    job.datePosted,
    job.source,
    job.sourceUrl,
  ]);

  const values = [headers, ...rows];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Jobs!A1',
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  // Format header row bold + freeze
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.2, green: 0.4, blue: 0.8 },
              },
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: headers.length },
          },
        },
      ],
    },
  });

  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  return { spreadsheetUrl, sheetName };
}
