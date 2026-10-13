-- The sign-in screen no longer asks for a newsletter opt-in, so the column is not needed.
ALTER TABLE mostro_app.users DROP COLUMN newsletter_opt_in;
