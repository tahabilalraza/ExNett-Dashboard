import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import yauzl from 'yauzl';

export const LIMITS = Object.freeze({ uploadBytes: 8 * 1024 * 1024, expandedBytes: 40 * 1024 * 1024, entries: 3000, rows: 2000, columns: 100, cellCharacters: 4000, stagingBytes: 10 * 1024 * 1024 });

export class ImportError extends Error {
  constructor(message, details) { super(message); this.name = 'ImportError'; this.details = details; }
}

// Check archive metadata before ExcelJS allocates and expands workbook contents.
export function inspectZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(new ImportError('The XLSX archive could not be read.'));
      let count = 0, expanded = 0, actualExpanded = 0, hasWorkbook = false, finished = false;
      const fail = (message) => { if (finished) return; finished = true; zip.close(); reject(new ImportError(message)); };
      zip.on('error', () => fail('The XLSX archive is malformed.'));
      zip.on('entry', (entry) => {
        count++; expanded += entry.uncompressedSize;
        if (count > LIMITS.entries || expanded > LIMITS.expandedBytes || entry.uncompressedSize > 20 * 1024 * 1024) return fail('The expanded workbook exceeds the safe import limits.');
        if (entry.generalPurposeBitFlag & 1) return fail('Encrypted workbooks are not supported.');
        if (/(^|\/)\.\.(\/|$)|^\//.test(entry.fileName)) return fail('The workbook contains an invalid archive path.');
        if (/vbaProject\.bin$|^xl\/externalLinks\//i.test(entry.fileName)) return fail('Workbooks with macros or external data links are not supported.');
        if (entry.fileName === 'xl/workbook.xml') hasWorkbook = true;
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        // Read bounded streams so forged ZIP size metadata cannot bypass the limit.
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail('The workbook archive entry is malformed.');
          let actualEntry = 0, xmlTail = '', physicalRows = 0, physicalCells = 0;
          const worksheetXml = /^xl\/worksheets\/[^/]+\.xml$/.test(entry.fileName);
          stream.on('data', chunk => {
            actualEntry += chunk.length; actualExpanded += chunk.length;
            if (actualEntry > 20 * 1024 * 1024 || actualExpanded > LIMITS.expandedBytes) {
              stream.destroy(); fail('The expanded workbook exceeds the safe import limits.');
            }
            // Bound allocations from hostile sheets with millions of styled/empty XML rows.
            if (worksheetXml && !finished) {
              const xml = xmlTail + chunk.toString('utf8');
              const end = xml.lastIndexOf('>');
              const complete = end >= 0 ? xml.slice(0, end + 1) : '';
              xmlTail = end >= 0 ? xml.slice(end + 1) : xml;
              physicalRows += (complete.match(/<(?:[\w.-]+:)?row(?:\s|>)/g) || []).length;
              physicalCells += (complete.match(/<(?:[\w.-]+:)?c(?:\s|>)/g) || []).length;
              if (physicalRows > 20000 || physicalCells > 200000 || xmlTail.length > 128 * 1024) {
                stream.destroy(); fail('The workbook contains too many worksheet rows, cells, or oversized XML markup.');
              }
            }
          });
          stream.on('error', () => fail('The workbook archive size or compression metadata is invalid.'));
          stream.on('end', () => { if (!finished) zip.readEntry(); });
        });
      });
      zip.on('end', () => {
        if (finished) return;
        finished = true;
        if (!hasWorkbook) reject(new ImportError('Upload an XLSX workbook, not another ZIP archive.'));
        else resolve();
      });
      zip.readEntry();
    });
  });
}

function cellValue(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return { text: '', kind: 'empty' };
  if (typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    return { text: '', kind: 'formula', formula: String(value.formula || value.sharedFormula).slice(0, LIMITS.cellCharacters) };
  }
  if (typeof value === 'object' && value.hyperlink) return { text: String(value.text || ''), kind: 'hyperlink', hyperlink: String(value.hyperlink) };
  if (typeof value === 'object' && value.richText) return { text: value.richText.map(item => item.text).join(''), kind: 'text' };
  if (typeof value === 'object' && value.error) return { text: '', kind: 'error' };
  if (value instanceof Date) return { text: value.toISOString(), kind: 'date' };
  return { text: String(value), kind: typeof value === 'number' ? 'number' : 'text' };
}

function checkCell(value) {
  if (value.text.length > LIMITS.cellCharacters || (value.hyperlink || '').length > LIMITS.cellCharacters) throw new ImportError(`A cell exceeds ${LIMITS.cellCharacters} characters.`);
  return value;
}

export async function parseFile(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ImportError('The upload is empty.');
  if (buffer.length > LIMITS.uploadBytes) throw new ImportError('Uploads must be 8 MB or smaller.');
  if (/\.xlsx$/i.test(filename)) {
    if (buffer.length < 4 || buffer.readUInt16LE(0) !== 0x4b50) throw new ImportError('The file does not have an XLSX signature.');
    await inspectZip(buffer);
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(buffer, { ignoreNodes: ['dataValidations', 'conditionalFormatting', 'drawing', 'picture', 'extLst'] }); }
    catch { throw new ImportError('The XLSX workbook could not be parsed.'); }
    const sheets = workbook.worksheets.filter(sheet => sheet.state === 'visible' || !sheet.state);
    const populated = sheets.filter(sheet => sheet.actualRowCount > 0);
    if (populated.length !== 1) throw new ImportError('Upload a workbook with exactly one populated visible worksheet; split multiple sheets into separate uploads.');
    const sheet = populated[0];
    const records = [];
    sheet.eachRow({ includeEmpty: false }, row => {
      const cells = [];
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        const value = checkCell(cellValue(cell));
        if (value.text || value.kind === 'formula' || value.kind === 'error') {
          if (column > LIMITS.columns) throw new ImportError('Populated worksheet columns exceed the import limit.');
          cells[column - 1] = value;
        }
      });
      if (cells.some(Boolean)) {
        records.push({ rowNumber: row.number, cells });
        if (records.length > LIMITS.rows + 1) throw new ImportError(`Imports are limited to ${LIMITS.rows} populated data rows.`);
      }
    });
    return finishRecords(records, { sheetName: sheet.name, sheetIndex: sheet.id, format: 'xlsx' });
  }
  if (!/\.csv$/i.test(filename)) throw new ImportError('Only CSV and XLSX files are supported.');
  if (buffer.includes(0)) throw new ImportError('CSV must use UTF-8 encoding without NUL bytes.');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new ImportError('CSV must use UTF-8 encoding.'); }
  let values;
  try { values = parse(source, { bom: true, skip_empty_lines: true, relax_column_count: true, max_record_size: LIMITS.columns * LIMITS.cellCharacters }); }
  catch { throw new ImportError('The CSV is malformed or contains an oversized record.'); }
  if (values.length > LIMITS.rows + 1) throw new ImportError(`Imports are limited to ${LIMITS.rows} populated data rows.`);
  const records = values.map((record, index) => {
    if (record.length > LIMITS.columns) throw new ImportError('CSV columns exceed the import limit.');
    return { rowNumber: index + 1, cells: record.map(value => checkCell({ text: value, kind: 'text' })) };
  }).filter(record => record.cells.some(cell => cell.text.trim()));
  return finishRecords(records, { sheetName: '', sheetIndex: 0, format: 'csv' });
}

function finishRecords(records, meta) {
  if (records.length < 2) throw new ImportError('The file must contain a header and at least one populated data row.');
  const header = records.shift();
  const columns = [];
  header.cells.forEach((cell, index) => { if (cell?.text.trim()) columns.push({ index, name: cell.text.trim() }); });
  const headers = columns.map(column => column.name);
  if (new Set(headers.map(name => name.toLowerCase())).size !== headers.length) throw new ImportError('Repeated or ambiguous headers must be renamed before upload.');
  for (const record of records) {
    record.cells.forEach((cell, index) => {
      if ((cell?.text || cell?.kind === 'formula') && !columns.some(column => column.index === index)) throw new ImportError('A populated data column has no header. Add a header before importing.');
    });
  }
  return { ...meta, headerRow: header.rowNumber, headers, records: records.map(record => ({ rowNumber: record.rowNumber, values: Object.fromEntries(columns.map(column => [column.name, record.cells[column.index] || { text: '', kind: 'empty' }])) })) };
}
