import {
  AttendanceStatus,
  ClassSessionStatus,
  SubscriptionStatus,
} from '@prisma/client';

export enum RecoveryState {
  AUTHORIZED = 'AUTHORIZED',
  COMPLETED = 'COMPLETED',
  MISSED = 'MISSED',
  CANCELLED = 'CANCELLED',
  UNAVAILABLE = 'UNAVAILABLE',
}
export enum RecoveryUnavailableReason {
  CLASS_CANCELLED = 'CLASS_CANCELLED',
  SUBSCRIPTION_INELIGIBLE = 'SUBSCRIPTION_INELIGIBLE',
  STUDENT_INACTIVE_AT_START = 'STUDENT_INACTIVE_AT_START',
}
export function subscriptionCoversRecovery(
  subscription: {
    periodStart: Date;
    periodEnd: Date;
    status: SubscriptionStatus;
    cancelledAt: Date | null;
  },
  startAt: Date,
) {
  return (
    subscription.periodStart <= startAt &&
    startAt < subscription.periodEnd &&
    (subscription.status === SubscriptionStatus.ACTIVE ||
      (subscription.cancelledAt !== null && subscription.cancelledAt > startAt))
  );
}
export function recoveryState(
  cancelledAt: Date | null,
  result: AttendanceStatus | null,
  target: { startAt: Date; status: ClassSessionStatus },
  subscription: Parameters<typeof subscriptionCoversRecovery>[0],
  historicallyActive: boolean,
) {
  if (cancelledAt)
    return { state: RecoveryState.CANCELLED, unavailableReason: null };
  if (result)
    return {
      state:
        result === AttendanceStatus.PRESENT
          ? RecoveryState.COMPLETED
          : RecoveryState.MISSED,
      unavailableReason: null,
    };
  const unavailableReason =
    target.status === ClassSessionStatus.CANCELLED
      ? RecoveryUnavailableReason.CLASS_CANCELLED
      : !subscriptionCoversRecovery(subscription, target.startAt)
        ? RecoveryUnavailableReason.SUBSCRIPTION_INELIGIBLE
        : !historicallyActive
          ? RecoveryUnavailableReason.STUDENT_INACTIVE_AT_START
          : null;
  return {
    state: unavailableReason
      ? RecoveryState.UNAVAILABLE
      : RecoveryState.AUTHORIZED,
    unavailableReason,
  };
}
export function consumesAllowance(recoveryId: string | null) {
  return recoveryId === null;
}

export function recoverableAbsence(
  attendance: {
    status: AttendanceStatus;
    recoveryId: string | null;
    classSessionId: string;
  },
  targetId: string,
) {
  return (
    attendance.status === AttendanceStatus.ABSENT &&
    attendance.recoveryId === null &&
    attendance.classSessionId !== targetId
  );
}
