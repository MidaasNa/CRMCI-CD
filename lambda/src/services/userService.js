'use strict';

const userRepository = require('../repositories/userRepository');
const { hashPassword } = require('../utils/auth');
const { passwordIssue } = require('../utils/validate');

const VALID_ROLES = ['Manager', 'Employee'];

// Gated on actor.canManageUsers specifically — a dedicated permission
// flag, separate from the Manager role. This lets the Users admin page
// (add/edit/delete users, reset passwords) be restricted to just one or
// two specific people, even when most/all accounts also hold the Manager
// role for other reasons (branch access, approvals, etc.).
function requireUserAdmin(actor) {
  if (!actor || !actor.canManageUsers) return 'You do not have access to manage users.';
  return null;
}

const userService = {
  // Public listing (no management fields) — any logged-in user, used to
  // populate assignment dropdowns etc. Matches the original behavior.
  // IMPORTANT: the frontend reads `json.users`, so this must be wrapped —
  // returning the bare array here silently left every assignment dropdown
  // showing only the logged-in user, since `json.users` came back
  // undefined and every caller defaulted to an empty list.
  async listPublic() {
    const rows = await userRepository.listPublic();
    return { users: rows };
  },

  // Full listing for the Admin/Users page — restricted to canManageUsers.
  async listForAdmin(actor) {
    const err = requireUserAdmin(actor);
    if (err) return { error: err };

    const rows = await userRepository.listAll();
    return {
      ok: true,
      users: rows.map(r => ({
        name: r.name,
        role: r.role,
        branch: r.branch,
        shift: r.shift,
        allBranchAccess: !!r.all_branch_access,
        canMarkLost: !!r.can_mark_lost,
        canChangePaymentStatus: !!r.can_change_payment_status,
        canManageUsers: !!r.can_manage_users
      }))
    };
  },

  async createUser(actor, input) {
    const err = requireUserAdmin(actor);
    if (err) return { error: err };

    const name = String(input && input.name || '').trim();
    if (!name) return { error: 'Name is required' };
    if (!input.role || !VALID_ROLES.includes(input.role)) return { error: `Role must be one of: ${VALID_ROLES.join(', ')}` };

    const passwordProblem = passwordIssue(input.password);
    if (passwordProblem) return { error: passwordProblem };

    if (await userRepository.nameInUseByOther(name, '')) {
      return { error: `A user named "${name}" already exists` };
    }

    const passwordHash = await hashPassword(input.password);
    await userRepository.create({
      name,
      passwordHash,
      role: input.role,
      branch: input.branch || '',
      shift: input.shift || 'Day',
      allBranchAccess: !!input.allBranchAccess,
      canMarkLost: !!input.canMarkLost,
      canChangePaymentStatus: !!input.canChangePaymentStatus,
      canManageUsers: !!input.canManageUsers
    });
    return { ok: true };
  },

  async updateUser(actor, currentName, patch) {
    const err = requireUserAdmin(actor);
    if (err) return { error: err };
    if (!currentName) return { error: 'Missing user to update' };

    const existing = await userRepository.findByNameCaseInsensitive(currentName);
    if (!existing) return { error: 'User not found' };

    const dbPatch = {};

    if ('newName' in patch && patch.newName && patch.newName.trim() !== existing.name) {
      const newName = patch.newName.trim();
      if (await userRepository.nameInUseByOther(newName, existing.name)) {
        return { error: `A user named "${newName}" already exists` };
      }
      dbPatch.newName = newName;
    }
    if ('role' in patch) {
      if (!VALID_ROLES.includes(patch.role)) return { error: `Role must be one of: ${VALID_ROLES.join(', ')}` };
      dbPatch.role = patch.role;
    }
    if ('branch' in patch) dbPatch.branch = patch.branch || '';
    if ('shift' in patch) dbPatch.shift = patch.shift || 'Day';
    if ('allBranchAccess' in patch) dbPatch.allBranchAccess = !!patch.allBranchAccess;
    if ('canMarkLost' in patch) dbPatch.canMarkLost = !!patch.canMarkLost;
    if ('canChangePaymentStatus' in patch) dbPatch.canChangePaymentStatus = !!patch.canChangePaymentStatus;
    if ('canManageUsers' in patch) {
      // Guard-rail: don't let the last remaining user-admin remove their
      // own access and lock everyone out of this page. They can still be
      // demoted by a DIFFERENT user-admin, or via the database directly.
      const removingSelf = !patch.canManageUsers && actor.name && existing.name.toLowerCase() === actor.name.toLowerCase();
      if (removingSelf) {
        const allUsers = await userRepository.listAll();
        const otherAdmins = allUsers.filter(u => u.can_manage_users && u.name.toLowerCase() !== actor.name.toLowerCase());
        if (otherAdmins.length === 0) {
          return { error: 'You are the only person with Users-page access — promote someone else first.' };
        }
      }
      dbPatch.canManageUsers = !!patch.canManageUsers;
    }

    const { changed } = await userRepository.update(existing.name, dbPatch);
    if (!changed) return { ok: true, noop: true };
    return { ok: true };
  },

  async deleteUser(actor, targetName) {
    const err = requireUserAdmin(actor);
    if (err) return { error: err };
    if (!targetName) return { error: 'Missing user to delete' };

    if (actor.name && targetName.trim().toLowerCase() === actor.name.trim().toLowerCase()) {
      return { error: 'You cannot delete your own account while logged in as it' };
    }

    const deleted = await userRepository.delete(targetName);
    if (!deleted) return { error: 'User not found' };
    return { ok: true };
  }
};

module.exports = userService;
