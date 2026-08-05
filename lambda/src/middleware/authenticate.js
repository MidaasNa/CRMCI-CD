'use strict';

const { verifyToken, extractBearerToken } = require('../utils/auth');

/**
 * Resolves the authenticated actor for this request from the signed JWT —
 * NEVER from an `actor` object in the request body. The previous version of
 * this API trusted a client-supplied `actor` field for permission checks
 * (role, canMarkLost, canChangePaymentStatus), which meant anyone calling
 * the API directly (not through the app) could claim to be a manager.
 * Returns null if there's no valid token.
 */
function authenticate(event) {
  const token = extractBearerToken(event);
  return verifyToken(token);
}

module.exports = { authenticate };
