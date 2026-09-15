// Allowlist by event. Unknown fields (including nested fields) never leave this API.
type Shape = { [key: string]: 'string' | 'number' | 'boolean' | Shape };
const plan: Shape = {
  name: 'string',
  description: 'string',
  classCount: 'number',
  price: 'string',
  currency: 'string',
  isActive: 'boolean',
};
const schedule: Shape = {
  dayOfWeek: 'number',
  startMinute: 'number',
  endMinute: 'number',
  defaultCapacity: 'number',
  isActive: 'boolean',
};
const shapes: Record<string, Shape> = {
  ADMIN_LOGIN: {},
  SESSION_REVOKED: { role: 'string' },
  STUDENT_ACCESS_CREATED: { studentId: 'string', expiresAt: 'string' },
  STUDENT_ACCESS_ACTIVATED: { sessionId: 'string' },
  STUDENT_ACCESS_REVOKED: { studentId: 'string' },
  STUDENT_CREATED: { fullName: 'string' },
  STUDENT_UPDATED: {
    before: { fullName: 'string' },
    after: { fullName: 'string' },
  },
  STUDENT_DEACTIVATED: {
    effectiveAt: 'string',
    revokedPendingAccesses: 'number',
    revokedSessions: 'number',
  },
  STUDENT_REACTIVATED: { effectiveAt: 'string' },
  PLAN_CREATED: plan,
  PLAN_UPDATED: { before: plan, after: plan },
  PLAN_ACTIVATED: {},
  PLAN_DEACTIVATED: {},
  SUBSCRIPTION_CREATED: {
    studentId: 'string',
    planId: 'string',
    planName: 'string',
    classAllowance: 'number',
    agreedPrice: 'string',
    currency: 'string',
    periodStart: 'string',
    periodEnd: 'string',
  },
  SUBSCRIPTION_CANCELLED: { cancelledAt: 'string' },
  PAYMENT_REGISTERED: {
    subscriptionId: 'string',
    amount: 'string',
    currency: 'string',
    paidAt: 'string',
    method: 'string',
  },
  PAYMENT_VOIDED: {
    subscriptionId: 'string',
    amount: 'string',
    currency: 'string',
    reason: 'string',
    voidedAt: 'string',
  },
  SCHEDULE_CREATED: schedule,
  SCHEDULE_UPDATED: { before: schedule, after: schedule },
  SCHEDULE_ACTIVATED: {},
  SCHEDULE_DEACTIVATED: {},
  ENROLLMENT_CREATED: {
    studentId: 'string',
    subscriptionId: 'string',
    scheduleId: 'string',
    validFrom: 'string',
    validUntil: 'string',
  },
  ENROLLMENT_ENDED: { before: 'string', after: 'string' },
  ENROLLMENT_SCHEDULE_CHANGED: {
    previousEnrollmentId: 'string',
    previousScheduleId: 'string',
    newScheduleId: 'string',
    effectiveDate: 'string',
  },
  CLASS_SESSIONS_GENERATED: {
    dateFrom: 'string',
    dateTo: 'string',
    candidateCount: 'number',
    createdCount: 'number',
    timeZone: 'string',
  },
  CLASS_SESSION_CAPACITY_CHANGED: { before: 'number', after: 'number' },
  CLASS_SESSION_TIME_CHANGED: {
    before: { startAt: 'string', endAt: 'string' },
    after: { startAt: 'string', endAt: 'string' },
  },
  CLASS_SESSION_CANCELLED: { reason: 'string' },
  CLASS_SESSION_ATTENDANCE_RECONCILED: {
    absencesCreated: 'number',
    historicallyEligible: 'number',
    unresolvedAllowance: 'number',
    completed: 'boolean',
  },
  ATTENDANCE_PRESENT_RECORDED: {
    classSessionId: 'string',
    subscriptionId: 'string',
  },
  ATTENDANCE_MANUAL_PRESENT_RECORDED: {
    classSessionId: 'string',
    subscriptionId: 'string',
    studentId: 'string',
    reason: 'string',
  },
  ATTENDANCE_CORRECTED: {
    correctionId: 'string',
    sequence: 'number',
    previousStatus: 'string',
    targetStatus: 'string',
    reason: 'string',
  },
  ATTENDANCE_CHALLENGE_ISSUED: {
    classSessionId: 'string',
    expiresAt: 'string',
    rotated: 'boolean',
    revokedCount: 'number',
  },
  RECOVERY_AUTHORIZED: {
    originalAttendanceId: 'string',
    targetClassSessionId: 'string',
    studentId: 'string',
    subscriptionId: 'string',
  },
  RECOVERY_CANCELLED: { reason: 'string' },
};
function project(value: unknown, shape: Shape): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>,
    result: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(shape)) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const entry = input[key];
    if (typeof rule === 'object') result[key] = project(entry, rule);
    else if (entry === null) result[key] = null;
    else if (
      typeof entry === rule &&
      (typeof entry !== 'string' || entry.length <= 500) &&
      (typeof entry !== 'number' || Number.isFinite(entry))
    )
      result[key] = entry;
  }
  return result;
}
export function publicAuditMetadata(
  action: string,
  value: unknown,
): Record<string, unknown> {
  return project(
    value,
    Object.prototype.hasOwnProperty.call(shapes, action) ? shapes[action] : {},
  );
}
