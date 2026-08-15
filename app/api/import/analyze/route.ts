import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { suggestMapping, toMappingRecord, missingFields } from '@/lib/import/mapping';
import { MAX_UPLOAD_BYTES, hasAcceptedExtension, parseUpload } from '@/lib/import/parse';
import { IMPORT_SCHEMAS } from '@/lib/import/schema';
import { validateRows } from '@/lib/import/validate';

export const runtime = 'nodejs';
export const maxDuration = 60;

const requestSchema = z.object({
  kind: z.enum(['usage', 'employees', 'contracts', 'assignments', 'denials']),
  /** Optional confirmed mapping; when absent, the response only suggests one. */
  mapping: z.record(z.string(), z.string()).optional(),
});

/** Rows sampled for the preview table shown next to the mapping controls. */
const PREVIEW_ROWS = 8;

export async function POST(request: Request) {
  const session = await getSession();
  if (session === null) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file was provided.' }, { status: 400 });
  }

  if (!hasAcceptedExtension(file.name)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload a CSV or XLSX export.' },
      { status: 415 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `File is ${(file.size / 1_048_576).toFixed(1)} MB, above the ${(MAX_UPLOAD_BYTES / 1_048_576).toFixed(0)} MB limit. Split the export by date range.`,
      },
      { status: 413 },
    );
  }

  const parsedBody = requestSchema.safeParse({
    kind: form.get('kind'),
    mapping: typeof form.get('mapping') === 'string' ? JSON.parse(String(form.get('mapping'))) : undefined,
  });

  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid import request.' }, { status: 400 });
  }

  const { kind, mapping: confirmedMapping } = parsedBody.data;

  let parsed;
  try {
    parsed = await parseUpload(file);
  } catch {
    return NextResponse.json(
      { error: 'The file could not be read. Check that it is a valid CSV or XLSX export.' },
      { status: 422 },
    );
  }

  if (parsed.headers.length === 0) {
    return NextResponse.json({ error: 'No column headers were found in the file.' }, { status: 422 });
  }

  const suggestions = suggestMapping(parsed.headers, kind);
  const mapping = confirmedMapping ?? toMappingRecord(suggestions);
  const validation = validateRows(parsed.rows, mapping, kind);
  const missing = missingFields(mapping, kind);

  return NextResponse.json({
    fileName: file.name,
    fileBytes: file.size,
    kind,
    schema: {
      label: IMPORT_SCHEMAS[kind].label,
      fields: IMPORT_SCHEMAS[kind].fields.map((field) => ({
        key: field.key,
        label: field.label,
        description: field.description,
        required: field.required,
        type: field.type,
      })),
    },
    headers: parsed.headers,
    suggestions,
    mapping,
    missingRequired: missing.required.map((field) => field.label),
    missingOptional: missing.optional.map((field) => field.label),
    preview: parsed.rows.slice(0, PREVIEW_ROWS),
    parsedRows: parsed.parsedRows,
    truncated: parsed.truncated,
    parseErrors: parsed.parseErrors,
    validation,
  });
}
