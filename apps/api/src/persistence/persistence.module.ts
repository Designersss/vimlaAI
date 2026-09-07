import { Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { RedisService } from "./redis.service.js";

@Module({
  providers: [PrismaService, RedisService],
  exports: [PrismaService, RedisService],
})
export class PersistenceModule {}
