import { Injectable } from '@nestjs/common';

export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

@Injectable()
export class SystemClock implements Clock {
  now() {
    return new Date();
  }
}
