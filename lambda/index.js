'use strict';

/**
 * CRM backend — AWS Lambda + PostgreSQL
 *
 * Layered structure:
 *   index.js                     -> HTTP routing only, no business logic
 *   src/middleware/authenticate  -> resolves the actor from a signed JWT
 *   src/services/*               -> business rules + permission checks
 *   src/repositories/*           -> all SQL lives here, nowhere else
 *   src/utils/*                  -> auth (JWT/bcrypt) and validation helpers
 *
 * Auth model: `login` verifies name+password and returns a signed JWT. Every
 * other action requires `Authorization: Bearer <token>` and the actor is
 * always taken from that verified token — never from a client-supplied
 * `actor` field in the body. (The previous version trusted whatever `actor`
 * object the frontend sent, which meant anyone who could reach the API
 * directly could claim to be a manager. That hole is now closed.)
 *
 * Response shape is deliberately kept close to the original: always HTTP
 * 200, with either the result or {error: "..."} in the body.
 */

const { authenticate } = require('./src/middleware/authenticate');
const authService = require('./src/services/authService');
const userService = require('./src/services/userService');
const bookingService = require('./src/services/bookingService');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

function respond(bodyObj, statusCode) {
  return {
    statusCode: statusCode || 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj)
  };
}

const UNAUTHENTICATED = () => respond({ error: 'Please log in again — your session is missing or has expired.' }, 401);

exports.handler = async (event) => {
  try {
    const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method)
      || event.httpMethod || 'GET';

    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    }

    if (method === 'GET') {
      const params = event.queryStringParameters || {};
      const action = params.action || 'records';

      // Every GET action requires a logged-in actor — this used to be
      // open to anyone who knew the API URL.
      const actor = authenticate(event);
      if (!actor) return UNAUTHENTICATED();

      if (action === 'users') return respond(await userService.listPublic());
      if (action === 'usersAdmin') return respond(await userService.listForAdmin(actor));
      return respond(await bookingService.list());
    }

    if (method === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (err) {
        return respond({ error: 'Invalid JSON body' });
      }

      // Login is the only action that doesn't require a token yet.
      if (body.action === 'login') {
        return respond(await authService.login(body.name, body.password));
      }

      const actor = authenticate(event);
      if (!actor) return UNAUTHENTICATED();

      switch (body.action) {
        case 'changePassword':
          return respond(await authService.changeOwnPassword(actor, body.currentPassword, body.newPassword));
        case 'resetPassword':
          return respond(await authService.resetUserPassword(actor, body.targetName, body.newPassword));

        case 'createUser':
          return respond(await userService.createUser(actor, body.user || {}));
        case 'updateUser':
          return respond(await userService.updateUser(actor, body.name, body.patch || {}));
        case 'deleteUser':
          return respond(await userService.deleteUser(actor, body.name));

        case 'create':
          return respond(await bookingService.create(body.record, actor));
        case 'assign':
        case 'selfAssign':
          return respond(await bookingService.assign(body.rowId, body.employeeName, body.branch, actor));
        case 'updateStatus':
          return respond(await bookingService.updateStatus(body.rowId, body.status, actor));
        case 'updateFields':
          return respond(await bookingService.updateFields(body.rowId, body.fields, actor));
        case 'delete':
          return respond(await bookingService.delete(body.rowId, actor));
        case 'markLost':
          return respond(await bookingService.markLost(actor));

        default:
          return respond({ error: 'Unknown action: ' + body.action });
      }
    }

    return respond({ error: 'Unsupported method: ' + method });
  } catch (err) {
    console.error(err);
    return respond({ error: err.message || 'Internal server error' });
  }
};
