'use strict';

const { pool } = require('../db');

function toPublicUser(row) {
  return {
    name: row.name,
    role: row.role,
    branch: row.branch,
    shift: row.shift || 'Day',
    allBranchAccess: !!row.all_branch_access
  };
}

const userRepository = {
  async findByNameCaseInsensitive(name) {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [String(name).trim()]
    );
    return rows[0] || null;
  },

  async canonicalName(rawName) {
    if (!rawName) return rawName;
    const trimmed = String(rawName).trim();
    const { rows } = await pool.query(
      'SELECT name FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [trimmed]
    );
    return rows.length ? rows[0].name : trimmed;
  },

  async listAll() {
    const { rows } = await pool.query(
      `SELECT name, role, branch, COALESCE(shift, 'Day') AS shift, all_branch_access,
              can_mark_lost, can_change_payment_status, can_manage_users
       FROM users ORDER BY name`
    );
    return rows;
  },

  async listPublic() {
    // Deliberately excludes can_mark_lost / can_change_payment_status /
    // can_manage_users — those are only ever returned to the specific
    // logged-in user via 'login', never in this general list.
    const rows = await this.listAll();
    return rows.map(toPublicUser);
  },

  async create({ name, passwordHash, role, branch, shift, allBranchAccess, canMarkLost, canChangePaymentStatus, canManageUsers }) {
    const { rows } = await pool.query(
      `INSERT INTO users (name, password_hash, role, branch, shift, all_branch_access, can_mark_lost, can_change_payment_status, can_manage_users)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING name`,
      [
        String(name).trim(), passwordHash, role, branch || null, shift || 'Day',
        !!allBranchAccess, !!canMarkLost, !!canChangePaymentStatus, !!canManageUsers
      ]
    );
    return rows[0];
  },

  async update(currentName, patch) {
    const setClauses = [];
    const values = [];
    let i = 1;

    const columnMap = {
      newName: 'name',
      role: 'role',
      branch: 'branch',
      shift: 'shift',
      allBranchAccess: 'all_branch_access',
      canMarkLost: 'can_mark_lost',
      canChangePaymentStatus: 'can_change_payment_status',
      canManageUsers: 'can_manage_users'
    };

    Object.keys(columnMap).forEach(key => {
      if (key in patch) {
        setClauses.push(`${columnMap[key]} = $${i}`);
        values.push(patch[key]);
        i++;
      }
    });

    if (!setClauses.length) return { changed: false };

    values.push(currentName);
    const result = await pool.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE name = $${i}`,
      values
    );
    return { changed: result.rowCount > 0 };
  },

  async updatePasswordHash(name, passwordHash) {
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE LOWER(name) = LOWER($2)',
      [passwordHash, name]
    );
    return result.rowCount > 0;
  },

  async delete(name) {
    const result = await pool.query('DELETE FROM users WHERE name = $1', [name]);
    return result.rowCount > 0;
  },

  async nameInUseByOther(name, excludingName) {
    const { rows } = await pool.query(
      'SELECT 1 FROM users WHERE LOWER(name) = LOWER($1) AND LOWER(name) <> LOWER($2) LIMIT 1',
      [name, excludingName || '']
    );
    return rows.length > 0;
  }
};

module.exports = userRepository;
