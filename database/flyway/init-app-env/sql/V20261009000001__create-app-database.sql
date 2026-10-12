-- Runs against the default `postgres` database as the superuser. Creates the application database.
CREATE DATABASE mostro_db
    ENCODING = 'UTF8'
    LC_COLLATE = 'C.UTF-8'
    LC_CTYPE = 'C.UTF-8'
    TEMPLATE = template0;
