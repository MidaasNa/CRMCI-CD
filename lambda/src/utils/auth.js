'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '12h'; // matches a work shift; forces re-login daily rather than never

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  // Fail loudly at cold start rather than silently signing tokens with a
  // weak/missing secret — a short or default secret makes tokens forgeable.
  console.error(
    'JWT_SECRET is missing or too short (need 32+ random chars). ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}

/**
 * Issues a signed token carrying only the identity + permission flags the
 * rest of the app needs. This — not any object the client sends — is the
 * single source of truth for "who is making this request".
 */
function signToken(user) {
  return jwt.sign(
    {
      sub: user.name,
      role: user.role,
      branch: user.branch,
      shift: user.shift || 'Day',
      allBranchAccess: !!user.all_branch_access,
      canMarkLost: !!user.can_mark_lost,
      canChangePaymentStatus: !!user.can_change_payment_status,
      canManageUsers: !!user.can_manage_users
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

/**
 * Verifies a token and returns the decoded actor, or null if missing/invalid/expired.
 * Never throws — callers just treat a null actor as "not authenticated".
 */
function verifyToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return {
      name: decoded.sub,
      role: decoded.role,
      branch: decoded.branch,
      shift: decoded.shift,
      allBranchAccess: !!decoded.allBranchAccess,
      canMarkLost: !!decoded.canMarkLost,
      canChangePaymentStatus: !!decoded.canChangePaymentStatus,
      canManageUsers: !!decoded.canManageUsers
    };
  } catch (err) {
    return null;
  }
}

function extractBearerToken(event) {
  const headers = event.headers || {};
  // API Gateway lower-cases header names in v2 (HTTP API) events, but not
  // always in v1 (REST API) — check both cases defensively.
  const raw = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1] : null;
}

async function hashPassword(plaintext) {
  return bcrypt.hash(String(plaintext), 10);
}

async function comparePassword(plaintext, hash) {
  return bcrypt.compare(String(plaintext), hash);
}

module.exports = { signToken, verifyToken, extractBearerToken, hashPassword, comparePassword };
