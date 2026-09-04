import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSettings } from '../config/env.validation';
import { AttendanceService } from './attendance.service';

@Injectable()
export class AttendanceReconciliationScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AttendanceReconciliationScheduler.name);
  private readonly intervalMs: number;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly attendance: AttendanceService,
    config: ConfigService,
  ) {
    this.intervalMs =
      getSettings(config).attendanceReconcileIntervalMinutes * 60_000;
  }

  async onApplicationBootstrap() {
    await this.runSafely();
    this.timer = setInterval(() => void this.runSafely(), this.intervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runSafely() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.attendance.reconcileDue();
      if (result.unresolvedAllowance > 0) {
        this.logger.warn(
          `Reconciliación pendiente por allowance: ${result.unresolvedAllowance}`,
        );
      }
    } catch {
      this.logger.error('Falló la reconciliación automática de Attendance');
    } finally {
      this.running = false;
    }
  }
}
