-- One row per person who signed in through Openfort. Wallets and passes are NOT stored here: they live on the blockchain.
CREATE TABLE mostro_app.users (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Openfort user id (usr_...). Identity comes from Openfort; this is the link back to it.
    openfort_id       text        NOT NULL UNIQUE,
    -- How the user signed in.
    login_type        text        NOT NULL CHECK (login_type IN ('email', 'google', 'apple', 'twitter')),
    email             text,
    -- Display name chosen on the profile step. NULL until the user sets one.
    name              text,
    -- Relative path of the avatar file inside the avatars folder: <user id>/<file>. NULL when there is none.
    avatar_url        text,
    newsletter_opt_in boolean     NOT NULL DEFAULT false,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_email_idx ON mostro_app.users (email);
