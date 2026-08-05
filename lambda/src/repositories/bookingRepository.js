'use strict';

const { pool, IST_NOW_SQL, IST_TODAY_SQL } = require('../db');

const TERMINAL_STATUSES = ['Confirmed', 'Lost'];

// Maps the frontend's camelCase field keys to actual DB columns. Mirrors
// keyFor_()/DATA_HEADERS in the original Apps Script — single source of
// truth for which fields exist and what they're called in the database.
const FIELD_TO_COLUMN = {
  date: 'request_date', client: 'client', tr: 'tr_number', city: 'city',
  country: 'country', vendor: 'vendor', checkin: 'check_in', checkout: 'check_out',
  nights: 'nights', bookingref: 'booking_ref', handled: 'handled_by', priority: 'priority',
  status: 'status', remarks: 'remarks', rowId: 'row_id', branch: 'branch',
  lastUpdated: 'last_updated', createdAt: 'created_at',
  reminderRequired: 'reminder_required', reminderSent: 'reminder_sent',
  reconfirmed: 'reconfirmed', reconfirmedBy: 'reconfirmed_by',
  hotelConfirmationNumber: 'hotel_confirmation_number', confirmationNumber: 'confirmation_number',
  invoiceNumber: 'invoice_number', paymentStatus: 'payment_status', paymentDeadline: 'payment_deadline'
};

// Fields a caller may touch via the generic 'updateFields' action —
// everything above except rowId/lastUpdated/createdAt/status/handled/branch,
// which all go through their own dedicated actions instead.
const UPDATABLE_FIELDS = [
  'client', 'tr', 'city', 'country', 'vendor', 'checkin', 'checkout', 'nights',
  'bookingref', 'priority', 'remarks',
  'reminderRequired', 'reminderSent', 'reconfirmed', 'reconfirmedBy',
  'hotelConfirmationNumber', 'confirmationNumber', 'invoiceNumber',
  'paymentStatus', 'paymentDeadline'
];

const ROW_TO_JSON_KEYS = [
  ['request_date', 'date'], ['client', 'client'], ['tr_number', 'tr'],
  ['city', 'city'], ['country', 'country'], ['vendor', 'vendor'],
  ['check_in', 'checkin'], ['check_out', 'checkout'], ['nights', 'nights'],
  ['booking_ref', 'bookingref'], ['handled_by', 'handled'], ['priority', 'priority'],
  ['status', 'status'], ['remarks', 'remarks'], ['row_id', 'rowId'], ['branch', 'branch'],
  ['last_updated', 'lastUpdated'], ['created_at', 'createdAt'],
  ['reminder_required', 'reminderRequired'], ['reminder_sent', 'reminderSent'],
  ['reconfirmed', 'reconfirmed'], ['reconfirmed_by', 'reconfirmedBy'],
  ['hotel_confirmation_number', 'hotelConfirmationNumber'],
  ['confirmation_number', 'confirmationNumber'], ['invoice_number', 'invoiceNumber'],
  ['payment_status', 'paymentStatus'], ['payment_deadline', 'paymentDeadline']
];

function bookingRowToJson(row) {
  const obj = {};
  ROW_TO_JSON_KEYS.forEach(([col, key]) => { obj[key] = row[col] === null ? '' : row[col]; });
  return obj;
}

const bookingRepository = {
  TERMINAL_STATUSES,
  UPDATABLE_FIELDS,
  bookingRowToJson,

  async findAll() {
    const { rows } = await pool.query('SELECT * FROM bookings ORDER BY request_date, tr_number');
    return rows.map(bookingRowToJson);
  },

  async findTrNumberAndHandledBy(rowId) {
    const { rows } = await pool.query('SELECT tr_number, handled_by, check_in, check_out, city, country FROM bookings WHERE row_id = $1', [rowId]);
    return rows[0] || null;
  },

  /**
   * Once a TR Number has someone in Handled By, only that same person or a
   * Manager may change Handled By/Status/fields on ANY row sharing that TR
   * Number. Returns an error string if blocked, or null if allowed.
   */
  async checkTrLock(rowId, actor) {
    if (!actor || !actor.name) return 'You must be logged in to do this.';
    if (actor.role === 'Manager') return null; // managers always allowed

    const row = await this.findTrNumberAndHandledBy(rowId);
    if (!row) return null; // row not found — let the caller's own lookup handle that error
    const thisTr = String(row.tr_number || '').trim();
    if (!thisTr) return null; // no TR Number on this row — nothing to lock against

    const { rows: conflict } = await pool.query(
      `SELECT handled_by FROM bookings
       WHERE TRIM(tr_number) = $1 AND handled_by IS NOT NULL AND TRIM(handled_by) <> ''
         AND LOWER(TRIM(handled_by)) <> LOWER($2)`,
      [thisTr, String(actor.name).trim()]
    );
    if (conflict.length) {
      const handledBy = conflict[0].handled_by;
      return `TR ${thisTr} is already assigned to ${handledBy}. Only ${handledBy} or a manager can make changes to it.`;
    }
    return null;
  },

  async insert(clean, handled, branch) {
    const { rows } = await pool.query(
      `INSERT INTO bookings (
         request_date, client, tr_number, city, country, vendor,
         check_in, check_out, nights, booking_ref, handled_by, priority,
         status, remarks, branch, last_updated, created_at,
         reminder_required, reminder_sent, reconfirmed, reconfirmed_by,
         hotel_confirmation_number, confirmation_number, invoice_number,
         payment_status, payment_deadline
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, ${IST_NOW_SQL}, ${IST_NOW_SQL},
         $16,$17,$18,$19,$20,$21,$22,$23,$24
       ) RETURNING *`,
      [
        clean.date || null, clean.client || '', clean.tr || '', clean.city || '',
        clean.country || '', clean.vendor || '', clean.checkin || null, clean.checkout || null,
        clean.nights || null, clean.bookingref || '', handled, clean.priority || '',
        clean.status || 'Open', clean.remarks || '', branch,
        clean.reminderRequired || '', clean.reminderSent || '', clean.reconfirmed || '',
        clean.reconfirmedBy || '', clean.hotelConfirmationNumber || '', clean.confirmationNumber || '',
        clean.invoiceNumber || '', clean.paymentStatus || '', clean.paymentDeadline || null
      ]
    );
    return bookingRowToJson(rows[0]);
  },

  async assign(rowId, canonicalName, branch) {
    // Only stamp a branch onto the ticket if it doesn't already have one —
    // overwriting an existing branch unconditionally would silently move a
    // ticket that belongs to another branch into the assigner's own, now
    // that AllBranchAccess users can assign tickets outside their own branch.
    const { rows, rowCount } = await pool.query(
      `UPDATE bookings
       SET handled_by = $1, status = 'Pending', last_updated = ${IST_NOW_SQL},
           branch = CASE WHEN branch IS NULL OR TRIM(branch) = '' THEN $2 ELSE branch END
       WHERE row_id = $3
       RETURNING *`,
      [canonicalName, branch || '', rowId]
    );
    if (!rowCount) return null;
    return bookingRowToJson(rows[0]);
  },

  async updateStatus(rowId, status) {
    const stampLastUpdated = TERMINAL_STATUSES.includes(status);
    const { rows, rowCount } = await pool.query(
      stampLastUpdated
        ? `UPDATE bookings SET status = $1, last_updated = ${IST_NOW_SQL} WHERE row_id = $2 RETURNING *`
        : 'UPDATE bookings SET status = $1 WHERE row_id = $2 RETURNING *',
      [status, rowId]
    );
    if (!rowCount) return null;
    return bookingRowToJson(rows[0]);
  },

  async updateFields(rowId, cleanFields) {
    const setClauses = [];
    const values = [];
    let i = 1;

    UPDATABLE_FIELDS.forEach(key => {
      if (key in cleanFields) {
        setClauses.push(`${FIELD_TO_COLUMN[key]} = $${i}`);
        values.push(cleanFields[key] === '' && ['checkin', 'checkout', 'paymentDeadline'].includes(key) ? null : cleanFields[key]);
        i++;
      }
    });

    if (!setClauses.length) return { noop: true };

    // LastUpdated is deliberately NEVER touched here — only Assign and
    // Status reaching Confirmed/Lost should move it.
    values.push(rowId);
    const { rows, rowCount } = await pool.query(
      `UPDATE bookings SET ${setClauses.join(', ')} WHERE row_id = $${i} RETURNING *`,
      values
    );
    if (!rowCount) return null;
    return bookingRowToJson(rows[0]);
  },

  async delete(rowId) {
    const result = await pool.query('DELETE FROM bookings WHERE row_id = $1', [rowId]);
    return result.rowCount > 0;
  },

  async markLostPastDue() {
    const { rows } = await pool.query(
      `UPDATE bookings
       SET status = 'Lost', last_updated = ${IST_NOW_SQL}
       WHERE status NOT IN ('Confirmed','Lost') AND check_in < ${IST_TODAY_SQL}
       RETURNING row_id, client, tr_number, check_in`
    );
    return rows.map(r => ({ rowId: r.row_id, client: r.client, tr: r.tr_number, checkin: r.check_in }));
  }
};

module.exports = bookingRepository;
