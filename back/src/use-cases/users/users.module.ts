import { Module } from "@nestjs/common";
import { SyncUserUseCase } from "./sync-user.use-case";
import { UpdateProfileUseCase } from "./update-profile.use-case";
import { UserRepository } from "./user.repository";
import { UsersController } from "./users.controller";

@Module({ controllers: [UsersController], providers: [UserRepository, SyncUserUseCase, UpdateProfileUseCase], exports: [UserRepository] })
export class UsersModule {}
