'use strict';

const bookingRepository = require('../repositories/bookingRepository');
const userRepository = require('../repositories/userRepository');

const TEXT_FIELDS = ['client', 'trNumber', 'city', 'country', 'vendor', 'bookingRef', 'remarks'];
// Note: 'tr'/'bookingref' are the actual payload keys used elsewhere; keep
// this list aligned with uppercaseTextFields' actual input keys below.
const UPPERCASE_KEYS = ['client', 'tr', 'city', 'country', 'vendor', 'bookingref', 'remarks'];

function uppercaseTextFields(fields) {
  const out = { ...fields };
  UPPERCASE_KEYS.forEach(k => {
    if (typeof out[k] === 'string') out[k] = out[k].toUpperCase().trim();
  });
  return out;
}

const bookingService = {
  async list() {
    return { records: await bookingRepository.findAll() };
  },

  async create(record, actor) {
    if (!record) return { error: 'Missing record' };

    const branch = record.branch || (actor && actor.branch) || '';
    const handled = await userRepository.canonicalName(record.handled || '');
    const clean = uppercaseTextFields(record);

    const saved = await bookingRepository.insert(clean, handled, branch);
    return { ok: true, rowId: saved.rowId, record: saved };
  },

  async assign(rowId, employeeName, branch, actor) {
    if (!rowId || !employeeName) return { error: 'Missing rowId or employeeName' };

    const lockError = await bookingRepository.checkTrLock(rowId, actor);
    if (lockError) return { error: lockError };

    const canonical = await userRepository.canonicalName(employeeName);
    const saved = await bookingRepository.assign(rowId, canonical, branch);
    if (!saved) return { error: 'rowId not found' };
    return { ok: true, record: saved };
  },

  async updateStatus(rowId, status, actor) {
    if (!rowId || !status) return { error: 'Missing rowId or status' };

    const lockError = await bookingRepository.checkTrLock(rowId, actor);
    if (lockError) return { error: lockError };

    // Enforced here too, not just in the UI — this is what actually
    // prevents a booking from being confirmed with no real dates on it,
    // regardless of how the request reaches the API.
    if (status === 'Confirmed') {
      const row = await bookingRepository.findTrNumberAndHandledBy(rowId);
      if (!row) return { error: 'rowId not found' };
      const missing = [];
      if (!row.city) missing.push('City');
      if (!row.country) missing.push('Country');
      if (!row.check_in) missing.push('Check In');
      if (!row.check_out) missing.push('Check Out');
      if (missing.length) {
        return { error: `Fill in ${missing.join(', ')} before marking this Confirmed.` };
      }
    }

    const saved = await bookingRepository.updateStatus(rowId, status);
    if (!saved) return { error: 'rowId not found' };
    return { ok: true, record: saved };
  },

  async updateFields(rowId, fields, actor) {
    if (!rowId || !fields) return { error: 'Missing rowId or fields' };

    const lockError = await bookingRepository.checkTrLock(rowId, actor);
    if (lockError) return { error: lockError };

    // Payment Status / Payment Deadline get a SEPARATE, stricter permission
    // check — not just checkTrLock's Manager bypass, since in practice
    // most/all accounts are "Manager", which would make that bypass apply
    // to everyone. Only someone flagged CanChangePaymentStatus, OR the
    // actual Handled By person for this row, may change these two.
    if ('paymentStatus' in fields || 'paymentDeadline' in fields) {
      const row = await bookingRepository.findTrNumberAndHandledBy(rowId);
      if (!row) return { error: 'rowId not found' };
      const handledBy = String(row.handled_by || '').trim().toLowerCase();
      const actorName = String((actor && actor.name) || '').trim().toLowerCase();
      const hasPaymentAccess = (actor && actor.canChangePaymentStatus === true) ||
        (handledBy && handledBy === actorName);
      if (!hasPaymentAccess) {
        return { error: 'Only the person who handled this booking, or someone with payment-status access, can change Blocked/Paid or the deadline.' };
      }
    }

    // Payment Deadline can never be later than the booking's own Check In
    // date — checked server-side too, since this endpoint is a public API.
    if ('paymentDeadline' in fields && fields.paymentDeadline) {
      const row = await bookingRepository.findTrNumberAndHandledBy(rowId);
      const checkinVal = row ? row.check_in : null;
      if (checkinVal && String(fields.paymentDeadline) > String(checkinVal)) {
        return { error: `Payment deadline cannot be after the Check In date (${checkinVal}).` };
      }
    }

    const clean = uppercaseTextFields(fields);
    const saved = await bookingRepository.updateFields(rowId, clean);
    if (!saved) return { error: 'rowId not found' };
    if (saved.noop) return { ok: true };
    return { ok: true, record: saved };
  },

  async delete(rowId, actor) {
    if (!rowId) return { error: 'Missing rowId' };

    const lockError = await bookingRepository.checkTrLock(rowId, actor);
    if (lockError) return { error: lockError };

    const deleted = await bookingRepository.delete(rowId);
    if (!deleted) return { error: 'rowId not found' };
    return { ok: true };
  },

  async markLost(actor) {
    if (!actor || actor.canMarkLost !== true) {
      return { error: 'Only specific people (CanMarkLost) can mark tickets as Lost' };
    }
    const moved = await bookingRepository.markLostPastDue();
    return { ok: true, moved };
  }
};

module.exports = bookingService;
