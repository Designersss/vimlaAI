import { type DynamicModule, Global, Module } from "@nestjs/common";
import type { ApiConfig } from "@vimla/config";
import { API_CONFIG } from "./api-config.js";

@Global()
@Module({})
export class ApiConfigModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: ApiConfigModule,
      global: true,
      providers: [
        {
          provide: API_CONFIG,
          useValue: config,
        },
      ],
      exports: [API_CONFIG],
    };
  }
}
