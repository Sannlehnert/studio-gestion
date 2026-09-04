import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSettings } from '../config/env.validation';
import {
  exclusiveLocalDateForInstant,
  localDateForInstant,
  localDateTimeToInstant,
} from './business-time';

@Injectable()
export class BusinessTimeService {
  readonly timeZone: string;

  constructor(config: ConfigService) {
    this.timeZone = getSettings(config).businessTimezone;
  }

  today(now = new Date()) {
    return localDateForInstant(now, this.timeZone);
  }

  localDate(value: Date) {
    return localDateForInstant(value, this.timeZone);
  }

  exclusiveLocalDate(value: Date) {
    return exclusiveLocalDateForInstant(value, this.timeZone);
  }

  instant(localDate: string, minuteOfDay: number) {
    return localDateTimeToInstant(localDate, minuteOfDay, this.timeZone);
  }
}
