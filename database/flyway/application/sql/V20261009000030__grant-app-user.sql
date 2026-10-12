-- The API logs in as ${appUser} and only needs to read and write rows.
GRANT USAGE ON SCHEMA mostro_app TO ${appUser};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mostro_app TO ${appUser};

-- Tables created by later migrations get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA mostro_app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appUser};
