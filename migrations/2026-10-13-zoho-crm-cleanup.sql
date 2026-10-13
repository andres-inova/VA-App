-- Zoho CRM is no longer used (2026-10-13). The app's VA records are the only source of VA details, and the
-- "Copy from Zoho" pages are gone, so these settings are not read any more:
--   va_source               which source VA details came from ('app' or 'zoho')
--   zoho_import             progress of the last copy of clients, contacts and VAs from Zoho CRM
--   zoho_import_applicants  progress of the last copy of applicants from Zoho CRM
-- Records, notes and files copied from Zoho CRM stay (with their zoho_id), as history.
-- Safe to run more than once.
DELETE FROM settings WHERE key IN ('va_source', 'zoho_import', 'zoho_import_applicants');
