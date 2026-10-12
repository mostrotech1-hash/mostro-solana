-- The LOGIN user the API connects as. Local development password only; change it for any shared environment.
CREATE ROLE ${appUser} LOGIN PASSWORD '${appUserPwd}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

REVOKE ALL ON DATABASE mostro_db FROM PUBLIC;
GRANT CONNECT ON DATABASE mostro_db TO ${appUser};
