import type { UserProfile } from "@mostro/shared/api";
import type { AvatarStorageService } from "../../modules/storage/avatar-storage.service";
import type { UserRecord } from "./user.repository";

/** Database row to the shape the fronts receive (see `shared/src/api`). */
export function toUserProfile(user: UserRecord, storage: AvatarStorageService): UserProfile {
   return { id: user.id, loginType: user.loginType, email: user.email, name: user.name, avatarUrl: storage.urlFor(user.avatarPath), kycStatus: user.kycStatus };
}
