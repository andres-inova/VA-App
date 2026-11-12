-- Client logins (client portal, step C1). A client login is a users row with is_client = 1, linked by record_id to
-- the client's CONTACT record (module 'contacts'); the contact's parent_id is the client they can see.
-- Run once (ALTER TABLE ADD COLUMN fails if run twice).
ALTER TABLE users ADD COLUMN is_client INTEGER NOT NULL DEFAULT 0;
