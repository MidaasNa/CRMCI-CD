'use strict';

const userRepository = require('../repositories/userRepository');
const { signToken, comparePassword, hashPassword } = require('../utils/auth');
const { passwordIssue } = require('../utils/validate');

const authService = {
  async login(name, password) {
    if (!name || !password) return { error: 'Name and password required' };

    const user = await userRepository.findByNameCaseInsensitive(name);
    if (!user) return { error: 'User not found' };

    const passwordMatches = await comparePassword(password, user.password_hash);
    if (!passwordMatches) return { error: 'Incorrect password' };

    const publicUser = {
      name: user.name,
      role: user.role,
      branch: user.branch,
      shift: user.shift || 'Day',
      allBranchAccess: !!user.all_branch_access,
      canMarkLost: !!user.can_mark_lost,
      canChangePaymentStatus: !!user.can_change_payment_status,
      canManageUsers: !!user.can_manage_users
    };

    return { ok: true, token: signToken(user), user: publicUser };
  },

  /**
   * Self-service password change — requires knowing the current password.
   * `actor` comes from the verified JWT, never from the request body, so a
   * caller can only ever change their own password this way.
   */
  async changeOwnPassword(actor, currentPassword, newPassword) {
    if (!actor || !actor.name) return { error: 'Not authenticated' };
    if (!currentPassword || !newPassword) return { error: 'Current and new password are required' };

    const issue = passwordIssue(newPassword);
    if (issue) return { error: issue };

    const user = await userRepository.findByNameCaseInsensitive(actor.name);
    if (!user) return { error: 'User not found' };

    const matches = await comparePassword(currentPassword, user.password_hash);
    if (!matches) return { error: 'Current password is incorrect' };

    const newHash = await hashPassword(newPassword);
    await userRepository.updatePasswordHash(user.name, newHash);
    return { ok: true };
  },

  /**
   * Resets another user's password without knowing their current one.
   * Gated on actor.canManageUsers — a dedicated flag, separate from the
   * Manager role, so this (and the rest of the Users admin page) can be
   * limited to just one or two specific people even if everyone else also
   * holds the Manager role for other reasons.
   */
  async resetUserPassword(actor, targetName, newPassword) {
    if (!actor || !actor.canManageUsers) return { error: 'You do not have access to manage users.' };
    if (!targetName || !newPassword) return { error: 'Target user and new password are required' };

    const issue = passwordIssue(newPassword);
    if (issue) return { error: issue };

    const target = await userRepository.findByNameCaseInsensitive(targetName);
    if (!target) return { error: 'User not found' };

    const newHash = await hashPassword(newPassword);
    await userRepository.updatePasswordHash(target.name, newHash);
    return { ok: true };
  }
};

module.exports = authService;
