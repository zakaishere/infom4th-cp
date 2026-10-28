CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email varchar(254) NOT NULL CHECK (email = lower(btrim(email)) AND position('@' in email) > 1),
    handle varchar(32) NOT NULL CHECK (handle ~ '^[A-Za-z0-9_]{3,32}$'),
    display_name varchar(100) NOT NULL CHECK (btrim(display_name) <> ''),
    password_hash varchar(255) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED')),
    email_verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (email)
);
CREATE UNIQUE INDEX users_handle_ci ON users (lower(handle));

CREATE TABLE roles (
    code varchar(32) PRIMARY KEY,
    description text NOT NULL
);
CREATE TABLE permissions (
    code varchar(80) PRIMARY KEY,
    description text NOT NULL
);
CREATE TABLE role_permissions (
    role_code varchar(32) NOT NULL REFERENCES roles(code),
    permission_code varchar(80) NOT NULL REFERENCES permissions(code),
    PRIMARY KEY (role_code, permission_code)
);
CREATE TABLE user_roles (
    user_id uuid NOT NULL REFERENCES users(id),
    role_code varchar(32) NOT NULL REFERENCES roles(code),
    granted_by uuid REFERENCES users(id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_code)
);
CREATE INDEX user_roles_role ON user_roles(role_code);

-- Store only digests of random refresh tokens, never bearer tokens in plaintext.
CREATE TABLE refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    token_digest char(64) NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);
CREATE INDEX refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX refresh_tokens_expiry ON refresh_tokens(expires_at);

INSERT INTO roles VALUES
    ('SUPER_ADMIN', 'Platform administration'),
    ('ADMIN', 'Contest organizer; resource access still requires ownership or a grant'),
    ('MODERATOR', 'Problem setter; access limited to assigned resources'),
    ('PARTICIPANT', 'Public competitions and published practice');
INSERT INTO permissions VALUES
    ('platform:manage', 'Manage users, roles, settings and judge infrastructure'),
    ('problem:create', 'Create a private draft'),
    ('problem:edit_assigned', 'Edit owned or assigned problem drafts'),
    ('problem:validate_assigned', 'Validate owned or assigned problem versions'),
    ('problem:approve_assigned', 'Approve assigned problem versions'),
    ('problem:publish_assigned', 'Publish assigned approved versions for practice'),
    ('competition:create', 'Create a private competition draft'),
    ('competition:manage_assigned', 'Manage owned or assigned competitions'),
    ('competition:publish_assigned', 'Publish assigned competitions'),
    ('rehearsal:join_assigned', 'Join rehearsals by explicit invitation'),
    ('competition:participate', 'Register and submit subject to eligibility and contest timing');
INSERT INTO role_permissions SELECT 'SUPER_ADMIN', code FROM permissions;
INSERT INTO role_permissions SELECT 'ADMIN', code FROM permissions WHERE code <> 'platform:manage';
INSERT INTO role_permissions SELECT 'MODERATOR', code FROM permissions WHERE code IN
    ('problem:create', 'problem:edit_assigned', 'problem:validate_assigned', 'rehearsal:join_assigned');
INSERT INTO role_permissions VALUES ('PARTICIPANT', 'competition:participate');

-- No preconfigured user, password, or privileged account is seeded.
