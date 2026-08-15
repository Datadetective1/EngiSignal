import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { ingestParsedFile } from '@/lib/ingestion';
import {
  EmptyFileError,
  UnsupportedFileError,
  decodeText,
  hasAcceptedExtension,
  looksLikeLegacyXls,
  looksLikeZip,
  parseDelimited,
  parseIngestionFile,
  parseWorkbook,
  sniffDelimiter,
} from '@/lib/ingestion/parse';

function toArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function buildWorkbook(
  sheets: { name: string; rows: string[][] }[],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    for (const row of sheet.rows) worksheet.addRow(row);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

describe('delimiter handling', () => {
  it('sniffs the delimiter from the header line', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(sniffDelimiter('a|b|c\n1|2|3')).toBe('|');
  });

  it('is not fooled by commas inside quoted values further down', () => {
    const text = 'name\tnote\nwidget\t"one, two, three"';
    expect(sniffDelimiter(text)).toBe('\t');
  });

  it('parses a TSV file', () => {
    const parsed = parseDelimited('date\tfeature\n2026-03-02\tMECH_ENT');
    expect(parsed.format).toBe('tsv');
    expect(parsed.sheets[0]!.headers).toEqual(['date', 'feature']);
    expect(parsed.sheets[0]!.rows[0]).toEqual({ date: '2026-03-02', feature: 'MECH_ENT' });
  });

  it('parses a semicolon-delimited export', () => {
    const parsed = parseDelimited('date;feature\n2026-03-02;MECH_ENT');
    expect(parsed.sheets[0]!.rows[0]).toEqual({ date: '2026-03-02', feature: 'MECH_ENT' });
  });
});

describe('encoding', () => {
  it('strips a UTF-8 byte-order mark', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('date,feature')]);
    expect(decodeText(withBom.buffer as ArrayBuffer)).toBe('date,feature');
  });

  it('decodes UTF-16LE, which Windows exports commonly use', () => {
    const text = 'date,feature\n2026-03-02,MECH_ENT';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let index = 0; index < text.length; index++) {
      bytes[2 + index * 2] = text.charCodeAt(index) & 0xff;
      bytes[3 + index * 2] = text.charCodeAt(index) >> 8;
    }
    const decoded = decodeText(bytes.buffer as ArrayBuffer);
    expect(decoded).toBe(text);

    // Without BOM handling this file parses as one unnamed column.
    const parsed = parseDelimited(decoded);
    expect(parsed.sheets[0]!.headers).toEqual(['date', 'feature']);
  });

  it('does not throw on a malformed byte', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('date,feature\nA,'), 0xff]);
    expect(() => decodeText(bytes.buffer as ArrayBuffer)).not.toThrow();
  });
});

describe('content sniffing', () => {
  it('recognizes a ZIP container, which is what XLSX is', async () => {
    const workbook = await buildWorkbook([{ name: 'Sheet1', rows: [['a'], ['1']] }]);
    expect(looksLikeZip(workbook)).toBe(true);
  });

  it('recognizes a legacy OLE2 .xls and refuses it explicitly', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
    expect(looksLikeLegacyXls(ole.buffer as ArrayBuffer)).toBe(true);
    await expect(parseIngestionFile(ole.buffer as ArrayBuffer, 'old.xls')).rejects.toBeInstanceOf(
      UnsupportedFileError,
    );
  });

  it('parses by content when the extension lies', async () => {
    const workbook = await buildWorkbook([
      { name: 'Usage', rows: [['date', 'feature'], ['2026-03-02', 'MECH_ENT']] },
    ]);
    // Named .csv but actually a workbook.
    const parsed = await parseIngestionFile(workbook, 'actually-a-workbook.csv');
    expect(parsed.format).toBe('xlsx');
    expect(parsed.totalRows).toBe(1);
  });

  it('accepts the documented extensions only', () => {
    expect(hasAcceptedExtension('usage.csv')).toBe(true);
    expect(hasAcceptedExtension('usage.tsv')).toBe(true);
    expect(hasAcceptedExtension('usage.xlsx')).toBe(true);
    expect(hasAcceptedExtension('usage.exe')).toBe(false);
    expect(hasAcceptedExtension('usage.xls')).toBe(false);
  });
});

describe('empty and malformed files', () => {
  it('rejects an empty file', async () => {
    await expect(parseIngestionFile(new ArrayBuffer(0), 'empty.csv')).rejects.toBeInstanceOf(
      EmptyFileError,
    );
  });

  it('rejects a whitespace-only file', () => {
    expect(() => parseDelimited('   \n  \n')).toThrow(EmptyFileError);
  });

  it('rejects a file with no usable headers', () => {
    expect(() => parseDelimited(',,,\n1,2,3')).toThrow(EmptyFileError);
  });

  it('rejects a workbook with no data rows', async () => {
    const workbook = await buildWorkbook([{ name: 'Empty', rows: [['date', 'feature']] }]);
    await expect(parseWorkbook(workbook)).rejects.toBeInstanceOf(EmptyFileError);
  });

  it('keeps trailing blank lines from becoming rejected rows', () => {
    const parsed = parseDelimited('date,feature\n2026-03-02,MECH_ENT\n\n\n');
    expect(parsed.totalRows).toBe(1);
  });
});

describe('workbooks', () => {
  it('reads every sheet rather than only the first', async () => {
    const workbook = await buildWorkbook([
      { name: 'March', rows: [['date', 'feature'], ['2026-03-02', 'MECH_ENT']] },
      { name: 'April', rows: [['date', 'feature'], ['2026-04-02', 'CFD_PREM']] },
    ]);

    const parsed = await parseWorkbook(workbook);
    expect(parsed.sheetNames).toEqual(['March', 'April']);
    expect(parsed.sheets).toHaveLength(2);
    expect(parsed.totalRows).toBe(2);
  });

  it('records which sheet each record came from', async () => {
    const workbook = await buildWorkbook([
      { name: 'March', rows: [['date', 'feature'], ['2026-03-02', 'MECH_ENT']] },
      { name: 'April', rows: [['date', 'feature'], ['2026-04-02', 'CFD_PREM']] },
    ]);

    const parsed = await parseWorkbook(workbook);
    const { result } = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: 'org-alpha',
      importId: 'import-sheets',
      fileName: 'multi.xlsx',
    });

    expect(result.usage).toHaveLength(2);
    expect(result.usage[0]!.provenance.sourceSheet).toBe('March');
    expect(result.usage[1]!.provenance.sourceSheet).toBe('April');
  });

  it('can be restricted to one worksheet', async () => {
    const workbook = await buildWorkbook([
      { name: 'March', rows: [['date', 'feature'], ['2026-03-02', 'MECH_ENT']] },
      { name: 'April', rows: [['date', 'feature'], ['2026-04-02', 'CFD_PREM']] },
    ]);

    const parsed = await parseWorkbook(workbook);
    const { result } = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: 'org-alpha',
      importId: 'import-one-sheet',
      fileName: 'multi.xlsx',
      sheetName: 'April',
    });

    expect(result.usage).toHaveLength(1);
    expect(result.usage[0]!.feature).toBe('CFD_PREM');
  });

  it('warns rather than failing silently when a named sheet is absent', async () => {
    const workbook = await buildWorkbook([
      { name: 'March', rows: [['date', 'feature'], ['2026-03-02', 'MECH_ENT']] },
    ]);
    const parsed = await parseWorkbook(workbook);
    const { result } = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: 'org-alpha',
      importId: 'import-missing-sheet',
      fileName: 'multi.xlsx',
      sheetName: 'Nope',
    });

    expect(result.warnings.some((warning) => warning.message.includes('No worksheet named'))).toBe(true);
  });

  it('preserves Excel date cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Usage');
    sheet.addRow(['date', 'feature']);
    sheet.addRow([new Date('2026-03-02T00:00:00Z'), 'MECH_ENT']);
    const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    const parsed = await parseWorkbook(buffer);
    const { result } = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: 'org-alpha',
      importId: 'import-dates',
      fileName: 'dates.xlsx',
    });

    expect(result.usage[0]!.date).toBe('2026-03-02');
  });
});

describe('row limits', () => {
  it('stops at the row limit and says so rather than truncating quietly', () => {
    const lines = ['date,feature'];
    for (let index = 0; index < 50; index++) lines.push(`2026-03-02,FEATURE_${index}`);

    const parsed = parseDelimited(lines.join('\n'), { maxRows: 10 });
    expect(parsed.totalRows).toBe(10);
    expect(parsed.truncated).toBe(true);
    expect(parsed.warnings.some((warning) => warning.code === 'row_limit_reached')).toBe(true);
  });
});

describe('large files', () => {
  it('handles a wide, long file without losing row alignment', () => {
    const lines = ['date,feature,user'];
    for (let index = 0; index < 5000; index++) {
      lines.push(`2026-03-02,FEATURE_${index % 7},user${index}`);
    }
    const parsed = parseDelimited(lines.join('\n'));
    const { result } = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: 'org-alpha',
      importId: 'import-large',
      fileName: 'large.csv',
    });

    expect(result.totalRows).toBe(5000);
    expect(result.acceptedRows).toBe(5000);
    // Last record must still point at the last line of the file.
    expect(result.usage.at(-1)!.provenance.sourceRow).toBe(5001);
  });
});

describe('accounting', () => {
  it('always balances accepted plus rejected against the rows read', () => {
    const parsed = parseDelimited(
      [
        'date,feature,licenses used',
        '2026-03-02,MECH_ENT,10',
        'bad,MECH_ENT,10',
        '2026-03-02,,10',
        '2026-03-02,MECH_ENT,-4',
        '2026-03-02,MECH_ENT,10',
      ].join('\n'),
    );
    const { result } = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: 'org-alpha',
      importId: 'import-balance',
      fileName: 'balance.csv',
    });

    expect(result.totalRows).toBe(5);
    expect(result.acceptedRows + result.rejectedRows).toBe(result.totalRows);
  });

  it('counts a row once even when it breaks several rules', () => {
    const parsed = parseDelimited(
      ['date,feature,licenses used,hour', 'bad-date,MECH_ENT,-9,99'].join('\n'),
    );
    const { result } = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: 'org-alpha',
      importId: 'import-multi-rule',
      fileName: 'multi-rule.csv',
    });

    expect(result.totalRows).toBe(1);
    expect(result.rejectedRows).toBe(1);
    // Every reason is still reported.
    expect(result.rejections.length).toBeGreaterThan(1);
  });
});

describe('environment-derived limits', () => {
  // Regression: a Vercel variable added but left blank is an empty string, and
  // Number('') is 0. That set the upload limit to zero in production and
  // rejected every file with "above the 0 MB limit".
  it('falls back when the variable is blank, missing or nonsense', async () => {
    const original = process.env.ENGISIGNAL_MAX_UPLOAD_BYTES;
    const load = async () => {
      vi.resetModules();
      return import('@/lib/ingestion/parse');
    };

    try {
      process.env.ENGISIGNAL_MAX_UPLOAD_BYTES = '';
      expect((await load()).MAX_UPLOAD_BYTES).toBe(26_214_400);

      process.env.ENGISIGNAL_MAX_UPLOAD_BYTES = '   ';
      expect((await load()).MAX_UPLOAD_BYTES).toBe(26_214_400);

      delete process.env.ENGISIGNAL_MAX_UPLOAD_BYTES;
      expect((await load()).MAX_UPLOAD_BYTES).toBe(26_214_400);

      process.env.ENGISIGNAL_MAX_UPLOAD_BYTES = 'not-a-number';
      expect((await load()).MAX_UPLOAD_BYTES).toBe(26_214_400);

      process.env.ENGISIGNAL_MAX_UPLOAD_BYTES = '0';
      expect((await load()).MAX_UPLOAD_BYTES).toBe(26_214_400);

      process.env.ENGISIGNAL_MAX_UPLOAD_BYTES = '-5';
      expect((await load()).MAX_UPLOAD_BYTES).toBe(26_214_400);

      // A genuine override is still honoured.
      process.env.ENGISIGNAL_MAX_UPLOAD_BYTES = '1048576';
      expect((await load()).MAX_UPLOAD_BYTES).toBe(1_048_576);
    } finally {
      if (original === undefined) delete process.env.ENGISIGNAL_MAX_UPLOAD_BYTES;
      else process.env.ENGISIGNAL_MAX_UPLOAD_BYTES = original;
      vi.resetModules();
    }
  });
});
