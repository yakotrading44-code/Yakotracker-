/**
 * Yako Trading tracker: Google Sheets backend.
 *
 * Setup (once):
 * 1. Create a new Google Sheet (e.g. "Yako Trading Records").
 * 2. In the sheet: Extensions > Apps Script. Delete what is there and paste this whole file.
 * 3. Change PASSCODE below to your own secret word, then click Save.
 * 4. Deploy > New deployment > type "Web app".
 *    Execute as: Me.  Who has access: Anyone.  Click Deploy and allow access.
 * 5. Copy the "Web app URL" (ends in /exec) into the tracker app.
 *
 * The "Records" and "Shipments" tabs are created automatically on first use.
 * You can read and edit them in the sheet, but keep the header row and the ID column as they are.
 */

const PASSCODE = 'change-me';

const TABLES = {
  transactions: {
    sheet: 'Records',
    columns: [
      ['id', 'ID'],
      ['date', 'Date'],
      ['type', 'Type'],
      ['category', 'Category'],
      ['description', 'Description'],
      ['client', 'Client'],
      ['amount', 'Amount'],
      ['currency', 'Currency'],
      ['rate', 'Rate to GHS'],
      ['amount_ghs', 'Amount (GHS)'],
      ['shipment_name', 'Shipment'],
      ['shipment_id', 'Shipment ID'],
      ['created_at', 'Created'],
    ],
  },
  shipments: {
    sheet: 'Shipments',
    columns: [
      ['id', 'ID'],
      ['name', 'Name'],
      ['supplier', 'Supplier'],
      ['forwarder', 'Forwarder'],
      ['order_date', 'Order date'],
      ['arrival_date', 'Arrival date'],
      ['status', 'Status'],
      ['notes', 'Notes'],
      ['created_at', 'Created'],
    ],
  },
};

// Kept as plain text so Sheets doesn't reformat them.
const TEXT_FIELDS = ['id', 'date', 'order_date', 'arrival_date', 'shipment_id', 'created_at'];

function doGet() {
  return json({ ok: true, app: 'yako-tracker' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const req = JSON.parse(e.postData.contents);
    if (PASSCODE === 'change-me') throw new Error('Set your own PASSCODE in the Apps Script code, then deploy again.');
    if (req.passcode !== PASSCODE) return json({ ok: false, code: 'auth', error: 'Wrong passcode' });

    switch (req.action) {
      case 'list':
        return json({ ok: true, transactions: readAll('transactions'), shipments: readAll('shipments') });
      case 'insert':
        return json({ ok: true, rows: insertRows(req.table, req.rows || [req.row]) });
      case 'update':
        return json({ ok: true, row: updateRow(req.table, req.id, req.row) });
      case 'remove':
        removeRow(req.table, req.id);
        return json({ ok: true });
      default:
        throw new Error('Unknown action: ' + req.action);
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function tableDef(table) {
  const def = TABLES[table];
  if (!def) throw new Error('Unknown table: ' + table);
  return def;
}

// Returns the sheet and a map of field -> column number (1-based), creating the sheet if needed.
function getSheet(table) {
  const def = tableDef(table);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.sheet);
  if (!sh) {
    sh = ss.insertSheet(def.sheet);
    sh.getRange(1, 1, 1, def.columns.length).setValues([def.columns.map((c) => c[1])]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  const cols = {};
  def.columns.forEach(([field, label]) => {
    let i = headers.indexOf(label);
    if (i < 0) {
      // header missing (older sheet or deleted): add it at the end
      i = headers.length;
      headers.push(label);
      sh.getRange(1, i + 1).setValue(label).setFontWeight('bold');
    }
    cols[field] = i + 1;
  });
  TEXT_FIELDS.forEach((f) => {
    if (cols[f]) sh.getRange(1, cols[f], sh.getMaxRows(), 1).setNumberFormat('@');
  });
  return { sh, cols, width: headers.length };
}

function cellOut(field, v, tz) {
  if (v instanceof Date) {
    return field === 'created_at' ? v.toISOString() : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  if (v === '') return null;
  return v;
}

function readAll(table) {
  const { sh, cols } = getSheet(table);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const out = [];
  values.forEach((r) => {
    const rec = {};
    Object.keys(cols).forEach((f) => (rec[f] = cellOut(f, r[cols[f] - 1], tz)));
    if (rec.id) out.push(rec);
  });
  return out;
}

function shipmentNames() {
  const names = {};
  readAll('shipments').forEach((s) => (names[s.id] = s.name));
  return names;
}

function toRow(table, rec, cols, width, names) {
  if (table === 'transactions') rec.shipment_name = rec.shipment_id ? names[rec.shipment_id] || '' : '';
  const row = new Array(width).fill('');
  Object.keys(cols).forEach((f) => {
    const v = rec[f];
    row[cols[f] - 1] = v === null || v === undefined ? '' : v;
  });
  return row;
}

function findRow(sh, idCol, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, idCol, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function insertRows(table, rows) {
  const { sh, cols, width } = getSheet(table);
  const names = table === 'transactions' ? shipmentNames() : {};
  const now = new Date().toISOString();
  const recs = rows.map((r) => Object.assign({}, r, { id: Utilities.getUuid(), created_at: now }));
  if (recs.length) {
    const values = recs.map((r) => toRow(table, r, cols, width, names));
    sh.getRange(sh.getLastRow() + 1, 1, values.length, width).setValues(values);
  }
  return recs;
}

function updateRow(table, id, patch) {
  const { sh, cols, width } = getSheet(table);
  const r = findRow(sh, cols.id, id);
  if (r < 0) throw new Error('Record not found (it may have been deleted in the sheet).');
  const current = readAll(table).find((x) => String(x.id) === String(id)) || {};
  const rec = Object.assign({}, current, patch, { id: current.id, created_at: current.created_at });
  const names = table === 'transactions' ? shipmentNames() : {};
  const row = toRow(table, rec, cols, width, names);
  // only write our own columns, leave any extra columns the user added
  Object.keys(cols).forEach((f) => sh.getRange(r, cols[f]).setValue(row[cols[f] - 1]));
  if (table === 'shipments' && patch.name !== undefined) relinkShipment(id, rec.name);
  return rec;
}

function removeRow(table, id) {
  const { sh, cols } = getSheet(table);
  const r = findRow(sh, cols.id, id);
  if (r > 0) sh.deleteRow(r);
  if (table === 'shipments') relinkShipment(id, null);
}

// Update (or clear, when name is null) the shipment on every record linked to it.
function relinkShipment(shipmentId, name) {
  const { sh, cols } = getSheet('transactions');
  const last = sh.getLastRow();
  if (last < 2) return;
  const ids = sh.getRange(2, cols.shipment_id, last - 1, 1).getValues();
  ids.forEach((v, i) => {
    if (String(v[0]) !== String(shipmentId)) return;
    sh.getRange(i + 2, cols.shipment_name).setValue(name || '');
    if (name === null) sh.getRange(i + 2, cols.shipment_id).setValue('');
  });
}
