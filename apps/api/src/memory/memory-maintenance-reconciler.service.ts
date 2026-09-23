import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { MemoryMaintenanceService } from "./memory-maintenance.service.js";

const RECONCILE_INTERVAL_MS = 15_000;
const RECONCILE_BATCH_SIZE = 32;

@Injectable()
export class MemoryMaintenanceReconciler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    MemoryMaintenanceReconciler.name,
  );
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(MemoryMaintenanceService)
    private readonly maintenance: MemoryMaintenanceService,
    @Inject(API_CONFIG)
    private readonly config: ApiRuntimeConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.memoryEnabled) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, RECONCILE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running || !this.config.memoryEnabled) return;
    this.running = true;
    try {
      await this.maintenance.reconcilePending(
        RECONCILE_BATCH_SIZE,
      );
    } catch (error: unknown) {
      this.logger.warn({
        msg: "memory.reconcile.failed",
        reason:
          error instanceof Error
            ? error.name
            : "unknown_error",
      });
    } finally {
      this.running = false;
    }
  }
}
