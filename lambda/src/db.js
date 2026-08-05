'use strict';

const { Pool, types } = require('pg');

// Return DATE and TIMESTAMP columns as plain strings ("YYYY-MM-DD" /
// "YYYY-MM-DD HH:mm:ss") instead of JS Date objects. node-postgres's
// default Date conversion applies the Lambda runtime's timezone, which
// can silently shift a date by one day — returning the raw string
// Postgres already formatted avoids that class of bug entirely.
types.setTypeParser(1082, str => str); // DATE
types.setTypeParser(1114, str => str); // TIMESTAMP WITHOUT TIME ZONE

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  max: 3, // Lambda scales by running many concurrent instances, each with
          // its own small pool — keep this low so you don't exhaust RDS's
          // max_connections under load. Use RDS Proxy if you outgrow this.
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
});

// The old Google Apps Script backend stamped every timestamp using the
// Google Sheet's own timezone (Asia/Kolkata / IST) — Session.getScriptTimeZone().
// Postgres's now() defaults to UTC instead. Since the frontend's entire
// "what counts as today" logic (Dashboard, night-shift windows, etc.) was
// built assuming timestamps already arrive in IST wall-clock terms, every
// place that stamps or compares a date/time needs to explicitly convert
// to IST — otherwise activity between midnight and 5:30 AM IST (and any
// date-boundary comparison generally) silently lands on the wrong day.
const IST_NOW_SQL = "(now() AT TIME ZONE 'Asia/Kolkata')";
const IST_TODAY_SQL = "(now() AT TIME ZONE 'Asia/Kolkata')::date";

module.exports = { pool, IST_NOW_SQL, IST_TODAY_SQL };
