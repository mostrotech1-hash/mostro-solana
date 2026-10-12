import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { UserProfile } from "@mostro/shared/api";
import { z } from "zod";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentIdentity, parseBody } from "../../common/http";
import type { OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { AvatarStorageService } from "../../modules/storage/avatar-storage.service";
import { SyncUserUseCase } from "./sync-user.use-case";
import { UpdateProfileUseCase } from "./update-profile.use-case";
import { toUserProfile } from "./user-presenter";
import { UserRepository } from "./user.repository";

const profileSchema = z.object({ name: z.string().trim().min(1, "Choose a display name.").max(40, "The name can have 40 characters at most.") });

@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
   constructor(
      @Inject(SyncUserUseCase) private readonly syncUser: SyncUserUseCase,
      @Inject(UpdateProfileUseCase) private readonly updateProfile: UpdateProfileUseCase,
      @Inject(UserRepository) private readonly users: UserRepository,
      @Inject(AvatarStorageService) private readonly storage: AvatarStorageService,
   ) {}

   @Post("sync")
   @HttpCode(200)
   sync(@CurrentIdentity() identity: OpenfortIdentity): Promise<UserProfile> {
      return this.syncUser.execute(identity);
   }

   @Get("me")
   async me(@CurrentIdentity() identity: OpenfortIdentity): Promise<UserProfile> {
      const user = await this.users.findByOpenfortId(identity.openfortId);
      if (!user) throw new NotFoundException("Unknown user. Sync the user first.");
      return toUserProfile(user, this.storage);
   }

   @Patch("me")
   setName(@CurrentIdentity() identity: OpenfortIdentity, @Body() body: unknown): Promise<UserProfile> {
      return this.updateProfile.setName(identity, parseBody(profileSchema, body));
   }

   @Post("me/avatar")
   @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024 } }))
   setAvatar(@CurrentIdentity() identity: OpenfortIdentity, @UploadedFile() file: Express.Multer.File | undefined): Promise<UserProfile> {
      if (!file) throw new BadRequestException("Send the picture in a `file` field.");
      return this.updateProfile.setAvatar(identity, file.buffer);
   }
}
