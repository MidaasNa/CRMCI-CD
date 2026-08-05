'use strict';

const MIN_PASSWORD_LENGTH = 8;

function passwordIssue(plaintext) {
  if (!plaintext || String(plaintext).length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

module.exports = { passwordIssue, MIN_PASSWORD_LENGTH };
