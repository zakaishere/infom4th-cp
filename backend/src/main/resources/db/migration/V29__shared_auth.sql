-- Delegated sign-in with InfoM4th. Users stay in this database; idp_subject holds the
-- stable subject ('sub') of the InfoM4th identity that owns the account. It is nullable
-- so existing local-password accounts keep working. password_hash becomes optional for
-- delegated users, but every row must have at least one credential.
ALTER TABLE users ADD COLUMN idp_subject varchar(255);
CREATE UNIQUE INDEX users_idp_subject_uq ON users (idp_subject) WHERE idp_subject IS NOT NULL;

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_has_credential
    CHECK (password_hash IS NOT NULL OR idp_subject IS NOT NULL);
