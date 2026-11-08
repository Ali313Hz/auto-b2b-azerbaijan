// MFA (TOTP) is optional for now: users may enroll an authenticator on the
// security page, and anyone who did must enter a code at login.
//
// To make it mandatory later, set this to true AND redefine
// private.mfa_required() to return true in a new migration. The database
// helper is the real enforcement; this flag only drives the UI redirects.
export const MFA_REQUIRED = false;

// Whether the 2FA settings page is linked from the admin nav and the
// customer account page. Hidden while authenticator apps are not in use;
// /security itself keeps working for anyone who opens it.
export const SHOW_MFA_SETTINGS = false;
