import { Inject, Injectable } from "@nestjs/common";
import type { UserProfile } from "@mostro/shared/api";
import { OpenfortService, type OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { AvatarStorageService } from "../../modules/storage/avatar-storage.service";
import { toUserProfile } from "./user-presenter";
import { UserRepository } from "./user.repository";

/** Called by the front right after every login: creates the user from what Openfort vouches for, or returns the existing one. */
@Injectable()
export class SyncUserUseCase {
   constructor(
      @Inject(UserRepository) private readonly users: UserRepository,
      @Inject(AvatarStorageService) private readonly storage: AvatarStorageService,
      @Inject(OpenfortService) private readonly openfort: OpenfortService,
   ) {}

   async execute(identity: OpenfortIdentity): Promise<UserProfile> {
      let user = await this.users.upsertFromLogin({
         openfortId: identity.openfortId,
         loginType: await this.openfort.loginTypeOf(identity.openfortId),
         email: identity.email,
      });

      if (!user.avatarPath && identity.imageUrl) {
         const path = await this.storage.saveFromUrl(user.id, identity.imageUrl);
         if (path) user = await this.users.updateAvatar(user.id, path);
      }
      return toUserProfile(user, this.storage);
   }
}
