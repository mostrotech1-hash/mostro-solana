import { Inject, Injectable } from "@nestjs/common";
import type { KycStatus, LoginType } from "@mostro/shared/api";
import type { Pool } from "pg";
import { PG_POOL } from "../../modules/database/database.module";

/** A row of `mostro_app.users`. `avatarPath` is relative (`<userId>/<file>`); the API turns it into a URL. */
export interface UserRecord {
   id: string;
   openfortId: string;
   loginType: LoginType;
   email: string | null;
   name: string | null;
   avatarPath: string | null;
   kycStatus: KycStatus;
}

const COLUMNS = `id, openfort_id AS "openfortId", login_type AS "loginType", email, name, avatar_url AS "avatarPath", kyc_status AS "kycStatus"`;

@Injectable()
export class UserRepository {
   constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

   /** First login creates the row; later logins only fill in an email we did not have. */
   async upsertFromLogin(input: { openfortId: string; loginType: LoginType; email: string | null }): Promise<UserRecord> {
      const { rows } = await this.pool.query<UserRecord>(
         `INSERT INTO mostro_app.users (openfort_id, login_type, email)
          VALUES ($1, $2, $3)
          ON CONFLICT (openfort_id) DO UPDATE SET email = COALESCE(mostro_app.users.email, EXCLUDED.email), updated_at = now()
          RETURNING ${COLUMNS}`,
         [input.openfortId, input.loginType, input.email],
      );
      return rows[0]!;
   }

   async findByOpenfortId(openfortId: string): Promise<UserRecord | null> {
      const { rows } = await this.pool.query<UserRecord>(`SELECT ${COLUMNS} FROM mostro_app.users WHERE openfort_id = $1`, [openfortId]);
      return rows[0] ?? null;
   }

   async findById(id: string): Promise<UserRecord | null> {
      const { rows } = await this.pool.query<UserRecord>(`SELECT ${COLUMNS} FROM mostro_app.users WHERE id = $1`, [id]);
      return rows[0] ?? null;
   }

   /** Stores what Sumsub said. Safe to repeat: the same event twice leaves the same row. Returns false when no such user. */
   async setKyc(id: string, status: KycStatus, applicantId: string | null): Promise<boolean> {
      const { rowCount } = await this.pool.query(
         `UPDATE mostro_app.users
             SET kyc_status = $2, sumsub_applicant_id = COALESCE($3, sumsub_applicant_id),
                 kyc_updated_at = CASE WHEN kyc_status IS DISTINCT FROM $2 THEN now() ELSE kyc_updated_at END, updated_at = now()
           WHERE id = $1`,
         [id, status, applicantId],
      );
      return (rowCount ?? 0) > 0;
   }

   async updateName(id: string, name: string): Promise<UserRecord> {
      const { rows } = await this.pool.query<UserRecord>(`UPDATE mostro_app.users SET name = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`, [id, name]);
      return rows[0]!;
   }

   async updateAvatar(id: string, avatarPath: string): Promise<UserRecord> {
      const { rows } = await this.pool.query<UserRecord>(`UPDATE mostro_app.users SET avatar_url = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`, [id, avatarPath]);
      return rows[0]!;
   }
}
