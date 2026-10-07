import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseFile, ImportError } from './parser.js';
import { resolveMapping, normalizeRow, markDuplicates, parseRate, canonicalLinkedIn } from './normalize.js';

test('offset headers and partial tables do not limit populated worksheet rows', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Synthetic experts');
  const headers = ['Full Name', 'Country', 'Current Company', 'Current Position', 'Email', 'Phone Number', 'LinkedIn Profile', 'Project', 'Industry', 'Status', 'Hourly Rate', 'Recruited By', 'Tags', 'Remarks'];
  headers.forEach((header, index) => sheet.getCell(1, index + 2).value = header);
  sheet.getCell('B2').value = 'Synthetic Person One';
  sheet.getCell('F2').value = { formula: '1+2', result: 3 };
  sheet.getCell('G2').value = 1234567890;
  sheet.getCell('H2').value = { text: 'https://www.linkedin.com/in/synthetic-one', hyperlink: 'http://www.linkedin.com/in/synthetic-one?trk=test' };
  sheet.getCell('I2').value = 'Synthetic Project, containing | punctuation';
  sheet.getCell('L2').value = '125 EUR';
  sheet.addTable({ name: 'PartialSyntheticTable', ref: 'B3', headerRow: false, columns: [{ name: 'Full Name' }, { name: 'Country' }], rows: [['Synthetic Person Two', 'Synthetic Country']] });
  sheet.getCell('B5').value = 'Synthetic Person Three';
  sheet.getCell('AB1220').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  const parsed = await parseFile(Buffer.from(await workbook.xlsx.writeBuffer()), 'synthetic.xlsx');
  assert.equal(parsed.headers.length, 14);
  assert.deepEqual(parsed.records.map(row => row.rowNumber), [2, 3, 5]);
  const normalized = normalizeRow(parsed.records[0], resolveMapping(parsed.headers));
  assert.equal(normalized.normalized.expertId, '');
  assert.equal(normalized.normalized.phoneNumber, '1234567890');
  assert.equal(normalized.normalized.email, '');
  assert.equal(normalized.raw.email.kind, 'formula');
  assert.equal(normalized.normalized.projectLabel, 'Synthetic Project, containing | punctuation');
  assert.deepEqual(normalized.normalized.rate, { amount: 125, currency: 'EUR' });
  assert(normalized.warnings.some(warning => warning.includes('formula')));
  assert(normalized.warnings.some(warning => warning.includes('non-HTTPS')));
});

test('CSV preserves leading zeros, quoted newlines, embedded contacts and optional blanks', async () => {
  const csv = 'Full Name,Email,Phone Number,Project,Hourly Rate,Remarks\r\n"Synthetic Person","Contact: first@example.test; second@example.test","0012345","Project, one | title","200 USD","line one\nline two"\r\n';
  const parsed = await parseFile(Buffer.from(csv), 'synthetic.csv');
  const row = normalizeRow(parsed.records[0], resolveMapping(parsed.headers));
  assert.equal(row.normalized.phoneNumber, '0012345');
  assert.equal(row.normalized.remarks, 'line one\nline two');
  assert.deepEqual(row.normalized.emails, ['first@example.test', 'second@example.test']);
  assert.equal(row.normalized.projectLabel, 'Project, one | title');
  assert.deepEqual(row.normalized.tags, []);
  assert.deepEqual(row.errors, []);
});

test('identity signals flag duplicates without merging different people', async () => {
  const parsed = await parseFile(Buffer.from('Full Name,Email\nSynthetic One,shared@example.test\nSynthetic Two,shared@example.test\n'), 'synthetic.csv');
  const rows = markDuplicates(parsed.records.map(record => normalizeRow(record, resolveMapping(parsed.headers))));
  assert.deepEqual(rows[0].duplicateRows, [3]);
  assert.deepEqual(rows[1].duplicateRows, [2]);
  assert.notEqual(rows[0].normalized.fullName, rows[1].normalized.fullName);
});

test('unmapped and repeated headers require explicit review', async () => {
  assert.throws(() => resolveMapping(['Full Name', 'Extra field']), ImportError);
  assert.equal(resolveMapping(['Full Name', 'Extra field'], { 'Extra field': 'ignore' })['Extra field'], 'ignore');
  await assert.rejects(parseFile(Buffer.from('Full Name,full name\nSynthetic,Other\n'), 'synthetic.csv'), ImportError);
  await assert.rejects(parseFile(Buffer.from([0x50]), 'synthetic.xlsx'), ImportError);
  await assert.rejects(parseFile(Buffer.from('Full Name\nSynthetic\0\n'), 'synthetic.csv'), ImportError);
});

test('rates never infer currency or zero and LinkedIn URLs stay on recognized hosts', () => {
  assert.equal(parseRate('125'), null);
  assert.equal(parseRate('$125'), null);
  assert.equal(parseRate('N/A'), null);
  assert.equal(parseRate('200 XYZ'), null);
  assert.deepEqual(parseRate('USD 125.50'), { amount: 125.5, currency: 'USD' });
  assert.deepEqual(parseRate('0 EUR'), { amount: 0, currency: 'EUR' });
  assert.equal(canonicalLinkedIn('javascript:alert(1)'), null);
  assert.equal(canonicalLinkedIn('https://linkedin.com.attacker.test/in/person'), null);
  assert.equal(canonicalLinkedIn('https://www.linkedin.com/in/Synthetic?trk=tracking'), 'https://www.linkedin.com/in/synthetic');
});

test('invalid normalized field lengths are preview errors rather than commit surprises', async () => {
  const parsed = await parseFile(Buffer.from(`Full Name,Country,Phone Number\nSynthetic,${'X'.repeat(151)},${'1'.repeat(201)}\n`), 'synthetic.csv');
  const row = normalizeRow(parsed.records[0], resolveMapping(parsed.headers));
  assert(row.errors.some(message => message.includes('Country')));
  assert(row.errors.some(message => message.includes('Phone Number')));
});
