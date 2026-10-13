import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { UpdateProfileRequest, UserProfile } from "@mostro/shared/api";
import type { OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { AvatarStorageService } from "../../modules/storage/avatar-storage.service";
import { toUserProfile } from "./user-presenter";
import { UserRepository } from "./user.repository";

@Injectable()
export class UpdateProfileUseCase {
   constructor(
      @Inject(UserRepository) private readonly users: UserRepository,
      @Inject(AvatarStorageService) private readonly storage: AvatarStorageService,
   ) {}

   async setName(identity: OpenfortIdentity, request: UpdateProfileRequest): Promise<UserProfile> {
      const user = await this.currentUser(identity);
      return toUserProfile(await this.users.updateName(user.id, request.name), this.storage);
   }

   async setAvatar(identity: OpenfortIdentity, bytes: Buffer): Promise<UserProfile> {
      const user = await this.currentUser(identity);
      const path = await this.storage.save(user.id, bytes);
      return toUserProfile(await this.users.updateAvatar(user.id, path), this.storage);
   }

   private async currentUser(identity: OpenfortIdentity) {
      const user = await this.users.findByOpenfortId(identity.openfortId);
      if (!user) throw new NotFoundException("Unknown user. Sync the user first.");
      return user;
   }
}
