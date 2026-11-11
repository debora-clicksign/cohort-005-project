import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { data } from "react-router";
import { db } from "~/db";
import {
  coupons,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  LessonProgressStatus,
  modules,
  purchases,
  refundRequests,
  RefundRequestStatus,
  refunds,
  RefundStatus,
  users,
  videoWatchEvents,
} from "~/db/schema";
import { formatPrice } from "~/lib/utils";

// ─── Refunds ───
// Everything about getting money back: who may raise a Refund Request, how an
// admin decides it, and the Refund that follows. Vocabulary follows
// GLOSSARY.md. Rule-breaking calls throw a `data()` response, like
// access.server, so routes can let them propagate.

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

// ─── Refund Window ───
// Counted in calendar days, not hours — a purchase at 23:00 still gets the
// whole of its fourteenth day.

function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

function lastDayOfWindow(purchasedAtIso: string): Date {
  const deadline = new Date(purchasedAtIso);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return deadline;
}

function daysLeftInWindow(purchasedAtIso: string, now: Date): number {
  const last = lastDayOfWindow(purchasedAtIso);
  const lastMidnight = new Date(last.getFullYear(), last.getMonth(), last.getDate());
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((lastMidnight.getTime() - todayMidnight.getTime()) / 86_400_000);
}

// ─── What the learner has done ───

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .get();
}

function getCourseLessonIds(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function getCompletedLessonCount(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.status, LessonProgressStatus.Completed),
          inArray(lessonProgress.lessonId, lessonIds)
        )
      )
      .get()?.count ?? 0
  );
}

/** The furthest point reached in each lesson's video, added up. */
function getSecondsWatched(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  return db
    .select({ furthest: sql<number>`max(${videoWatchEvents.positionSeconds})` })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all()
    .reduce((total, row) => total + row.furthest, 0);
}

function getOpenRefundRequest(purchaseId: number) {
  return db
    .select()
    .from(refundRequests)
    .where(
      and(
        eq(refundRequests.purchaseId, purchaseId),
        eq(refundRequests.status, RefundRequestStatus.Open)
      )
    )
    .get();
}

/** A learner gets at most one Refund per course, across all their purchases. */
function hasHadRefundForCourse(userId: number, courseId: number) {
  return !!db
    .select({ id: refunds.id })
    .from(refunds)
    .innerJoin(refundRequests, eq(refunds.refundRequestId, refundRequests.id))
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .get();
}

function hasClaimedSeat(purchaseId: number) {
  return !!db
    .select({ id: coupons.id })
    .from(coupons)
    .where(and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt)))
    .get();
}

// ─── Refund Eligibility ───

export type RefundEligibility =
  | { eligible: true; purchaseId: number; amount: number; lastDayInWindow: string }
  | { eligible: false; reason: string; status: number };

/**
 * Whether the learner may raise a Refund Request on their latest purchase of
 * this course. Decides who may ask — not what the admin decides.
 */
export function getRefundEligibility(
  userId: number,
  courseId: number,
  now: Date = new Date()
): RefundEligibility {
  const purchase = getLatestPurchase(userId, courseId);

  if (!purchase) {
    return { eligible: false, reason: "You have not bought this course.", status: 403 };
  }

  if (getOpenRefundRequest(purchase.id)) {
    return {
      eligible: false,
      reason: "You already have an open refund request on this purchase.",
      status: 409,
    };
  }

  if (hasHadRefundForCourse(userId, courseId)) {
    return {
      eligible: false,
      reason: "You have already been refunded for this course once.",
      status: 403,
    };
  }

  // A seat that came out of a Team Licence, and has been claimed, belongs to
  // the team — the licence can only be refunded while every seat is unclaimed.
  if (hasClaimedSeat(purchase.id)) {
    return { eligible: false, reason: "A claimed team seat cannot be refunded.", status: 403 };
  }

  const lastDay = lastDayOfWindow(purchase.createdAt);
  if (calendarDay(now) > calendarDay(lastDay)) {
    return {
      eligible: false,
      reason: `The ${REFUND_WINDOW_DAYS}-day window has closed.`,
      status: 403,
    };
  }

  const lessonIds = getCourseLessonIds(courseId);

  if (
    lessonIds.length > 0 &&
    getCompletedLessonCount(userId, lessonIds) / lessonIds.length >= REFUND_COMPLETION_LIMIT
  ) {
    return {
      eligible: false,
      reason: "You have completed too much of this course to request a refund.",
      status: 403,
    };
  }

  if (getSecondsWatched(userId, lessonIds) >= REFUND_WATCH_LIMIT_SECONDS) {
    return {
      eligible: false,
      reason: "You have watched too much of this course to request a refund.",
      status: 403,
    };
  }

  return {
    eligible: true,
    purchaseId: purchase.id,
    amount: purchase.amountPaid,
    lastDayInWindow: calendarDay(lastDay),
  };
}

// ─── Emails ───
// There is no mail transport wired up yet, so built messages go to the
// server log.

type Email = { to: string; subject: string; body: string };

function sendEmail(email: Email) {
  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);
}

function emailLearner(input: {
  learnerName: string;
  learnerEmail: string;
  subject: string;
  lines: string[];
}) {
  sendEmail({
    to: input.learnerEmail,
    subject: input.subject,
    body: [`Hi ${input.learnerName},`, "", ...input.lines, "", "— The Cadence team"].join("\n"),
  });
}

// ─── Raising a Refund Request ───

export function requestRefund(userId: number, courseId: number, reason: string) {
  const eligibility = getRefundEligibility(userId, courseId);

  if (!eligibility.eligible) {
    throw data(eligibility.reason, { status: eligibility.status });
  }

  const request = db
    .insert(refundRequests)
    .values({
      purchaseId: eligibility.purchaseId,
      status: RefundRequestStatus.Open,
      reason,
    })
    .returning()
    .get();

  const context = getRequestContext(request.id);
  emailLearner({
    ...context,
    subject: `Refund requested — ${context.courseTitle}`,
    lines: [
      `We have your refund request for "${context.courseTitle}".`,
      `The refund is for ${formatPrice(context.amountPaid)}, the amount you paid.`,
      "",
      "Our team reviews every refund request by hand. You do not need to do anything else — we will email you again when it is done.",
    ],
  });

  return request;
}

function getRequestContext(requestId: number) {
  const row = db
    .select({
      request: refundRequests,
      purchase: purchases,
      learnerName: users.name,
      learnerEmail: users.email,
      courseTitle: courses.title,
      amountPaid: purchases.amountPaid,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refundRequests.id, requestId))
    .get();

  if (!row) {
    throw data("Refund request not found.", { status: 404 });
  }

  return row;
}

const ALREADY_DECIDED = "This refund request has already been decided.";

// ─── Deciding a Refund Request ───

/**
 * Accepts the request: starts a Pending Refund for the full amount paid, ends
 * the learner's access, and stops unclaimed Seat Codes from working.
 */
export function approveRefundRequest(requestId: number, adminId: number) {
  const context = getRequestContext(requestId);
  const now = new Date().toISOString();

  const refund = db.transaction((tx) => {
    // Conditional on still being open, so two admins deciding at once cannot
    // both win.
    const decided = tx
      .update(refundRequests)
      .set({
        status: RefundRequestStatus.Approved,
        decidedAt: now,
        decidedByUserId: adminId,
      })
      .where(
        and(
          eq(refundRequests.id, requestId),
          eq(refundRequests.status, RefundRequestStatus.Open)
        )
      )
      .run();

    if (decided.changes === 0) {
      throw data(ALREADY_DECIDED, { status: 409 });
    }

    tx.update(enrollments)
      .set({ refundedAt: now })
      .where(
        and(
          eq(enrollments.userId, context.purchase.userId),
          eq(enrollments.courseId, context.purchase.courseId),
          isNull(enrollments.refundedAt)
        )
      )
      .run();

    tx.update(coupons)
      .set({ voidedAt: now })
      .where(
        and(
          eq(coupons.purchaseId, context.purchase.id),
          isNull(coupons.redeemedAt),
          isNull(coupons.voidedAt)
        )
      )
      .run();

    return tx
      .insert(refunds)
      .values({
        refundRequestId: requestId,
        amount: context.purchase.amountPaid,
        status: RefundStatus.Pending,
        createdAt: now,
        updatedByUserId: adminId,
      })
      .returning()
      .get();
  });

  emailLearner({
    ...context,
    subject: `Refund approved — ${context.courseTitle}`,
    lines: [
      `Your refund request for "${context.courseTitle}" has been approved.`,
      `We are sending ${formatPrice(refund.amount)} back to the card you paid with, and will email you once it is on its way. Your access to the course has ended.`,
    ],
  });

  return refund;
}

export function declineRefundRequest(
  requestId: number,
  adminId: number,
  declineReason: string
) {
  const context = getRequestContext(requestId);

  const decided = db
    .update(refundRequests)
    .set({
      status: RefundRequestStatus.Declined,
      declineReason,
      decidedAt: new Date().toISOString(),
      decidedByUserId: adminId,
    })
    .where(
      and(
        eq(refundRequests.id, requestId),
        eq(refundRequests.status, RefundRequestStatus.Open)
      )
    )
    .run();

  if (decided.changes === 0) {
    throw data(ALREADY_DECIDED, { status: 409 });
  }

  emailLearner({
    ...context,
    subject: `Refund request declined — ${context.courseTitle}`,
    lines: [
      `We have declined your refund request for "${context.courseTitle}".`,
      "",
      declineReason,
      "",
      "You keep your access to the course.",
    ],
  });
}

// ─── Sending the money ───

function getRefundContext(refundId: number) {
  const refund = db.select().from(refunds).where(eq(refunds.id, refundId)).get();

  if (!refund) {
    throw data("Refund not found.", { status: 404 });
  }

  return { refund, ...getRequestContext(refund.refundRequestId) };
}

/** A Pending or Failed Refund whose money has now been sent. */
export function markRefundIssued(refundId: number, adminId: number) {
  const context = getRefundContext(refundId);

  const updated = db
    .update(refunds)
    .set({
      status: RefundStatus.Issued,
      issuedAt: new Date().toISOString(),
      updatedByUserId: adminId,
    })
    .where(and(eq(refunds.id, refundId), ne(refunds.status, RefundStatus.Issued)))
    .run();

  if (updated.changes === 0) {
    throw data("This refund has already been issued.", { status: 409 });
  }

  emailLearner({
    ...context,
    subject: `Refund sent — ${context.courseTitle}`,
    lines: [
      `We have sent ${formatPrice(context.refund.amount)} back to the card you paid for "${context.courseTitle}" with.`,
      "Depending on your bank, it can take a few days to show up.",
    ],
  });
}

/** The money could not be sent. The decision stands; an admin can retry. */
export function markRefundFailed(refundId: number, adminId: number) {
  getRefundContext(refundId);

  const updated = db
    .update(refunds)
    .set({
      status: RefundStatus.Failed,
      failedAt: new Date().toISOString(),
      updatedByUserId: adminId,
    })
    .where(and(eq(refunds.id, refundId), eq(refunds.status, RefundStatus.Pending)))
    .run();

  if (updated.changes === 0) {
    throw data("Only a pending refund can be marked as failed.", { status: 409 });
  }
}

// ─── Lists ───

/** Open Refund Requests, oldest first, with what an admin needs to decide. */
export function listOpenRefundRequests(now: Date = new Date()) {
  const rows = db
    .select({
      id: refundRequests.id,
      reason: refundRequests.reason,
      requestedAt: refundRequests.requestedAt,
      purchasedAt: purchases.createdAt,
      amountPaid: purchases.amountPaid,
      learnerId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refundRequests.status, RefundRequestStatus.Open))
    .orderBy(asc(refundRequests.requestedAt), asc(refundRequests.id))
    .all();

  return rows.map((row) => {
    const lessonIds = getCourseLessonIds(row.courseId);
    return {
      ...row,
      daysLeftInWindow: daysLeftInWindow(row.purchasedAt, now),
      hoursWatched:
        Math.round((getSecondsWatched(row.learnerId, lessonIds) / 3600) * 10) / 10,
      lessonsCompleted: getCompletedLessonCount(row.learnerId, lessonIds),
      lessonCount: lessonIds.length,
    };
  });
}

/** Pending and Failed Refunds — money still owed to a learner. */
export function listUnsentRefunds() {
  return db
    .select({
      id: refunds.id,
      amount: refunds.amount,
      status: refunds.status,
      approvedAt: refunds.createdAt,
      failedAt: refunds.failedAt,
      learnerName: users.name,
      learnerEmail: users.email,
      courseTitle: courses.title,
    })
    .from(refunds)
    .innerJoin(refundRequests, eq(refunds.refundRequestId, refundRequests.id))
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(inArray(refunds.status, [RefundStatus.Pending, RefundStatus.Failed]))
    .orderBy(asc(refunds.createdAt), asc(refunds.id))
    .all();
}

/** Every decided Refund Request, most recent decision first. */
export function listDecidedRefundRequests() {
  const decider = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .as("decider");

  return db
    .select({
      id: refundRequests.id,
      status: refundRequests.status,
      reason: refundRequests.reason,
      declineReason: refundRequests.declineReason,
      requestedAt: refundRequests.requestedAt,
      decidedAt: refundRequests.decidedAt,
      decidedByName: decider.name,
      amountPaid: purchases.amountPaid,
      learnerName: users.name,
      courseTitle: courses.title,
      refundStatus: refunds.status,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(decider, eq(refundRequests.decidedByUserId, decider.id))
    .leftJoin(refunds, eq(refunds.refundRequestId, refundRequests.id))
    .where(ne(refundRequests.status, RefundRequestStatus.Open))
    .orderBy(desc(refundRequests.decidedAt), desc(refundRequests.id))
    .all();
}

// ─── Instructor revenue ───
// `instructorId` null means every instructor. `since` is an inclusive ISO
// start, or null for all time.

function ownedBy(instructorId: number | null) {
  return instructorId === null ? undefined : eq(courses.instructorId, instructorId);
}

function totalsByCourse(rows: { courseId: number; cents: number | null }[]) {
  return new Map(rows.map((row) => [row.courseId, Number(row.cents ?? 0)]));
}

/**
 * Refunded Revenue by course, counted by the date the Refund was Issued — so a
 * refund lands in the period it happened and past periods never change.
 */
export function getRefundedRevenueByCourse(
  instructorId: number | null,
  since: string | null
) {
  return totalsByCourse(
    db
      .select({ courseId: courses.id, cents: sql<number>`sum(${refunds.amount})` })
      .from(refunds)
      .innerJoin(refundRequests, eq(refunds.refundRequestId, refundRequests.id))
      .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .where(
        and(
          eq(refunds.status, RefundStatus.Issued),
          ownedBy(instructorId),
          since === null ? undefined : sql`${refunds.issuedAt} >= ${since}`
        )
      )
      .groupBy(courses.id)
      .all()
  );
}

/** Refunded Revenue grouped by the leading `bucketLength` characters of the issue date. */
export function getRefundedRevenueByBucket(
  instructorId: number | null,
  since: string | null,
  bucketLength: 7 | 10
) {
  const bucket = sql<string>`substr(${refunds.issuedAt}, 1, ${bucketLength})`;
  return new Map(
    db
      .select({ bucket, cents: sql<number>`sum(${refunds.amount})` })
      .from(refunds)
      .innerJoin(refundRequests, eq(refunds.refundRequestId, refundRequests.id))
      .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .where(
        and(
          eq(refunds.status, RefundStatus.Issued),
          ownedBy(instructorId),
          since === null ? undefined : sql`${refunds.issuedAt} >= ${since}`
        )
      )
      .groupBy(bucket)
      .all()
      .map((row) => [row.bucket, Number(row.cents ?? 0)] as const)
  );
}

/**
 * On Hold Revenue by course: purchases with an Open Refund Request, or with a
 * Pending or Failed Refund. `since` filters by purchase date.
 */
export function getOnHoldRevenueByCourse(
  instructorId: number | null,
  since: string | null
) {
  return totalsByCourse(
    db
      .select({ courseId: courses.id, cents: sql<number>`sum(${purchases.amountPaid})` })
      .from(refundRequests)
      .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .leftJoin(refunds, eq(refunds.refundRequestId, refundRequests.id))
      .where(
        and(
          sql`(${refundRequests.status} = ${RefundRequestStatus.Open} or ${refunds.status} in (${RefundStatus.Pending}, ${RefundStatus.Failed}))`,
          ownedBy(instructorId),
          since === null ? undefined : sql`${purchases.createdAt} >= ${since}`
        )
      )
      .groupBy(courses.id)
      .all()
  );
}

/** Every Refund Request a learner has raised, newest first, with its Refund. */
export function listLearnerRefundRequests(userId: number) {
  return db
    .select({
      id: refundRequests.id,
      status: refundRequests.status,
      reason: refundRequests.reason,
      declineReason: refundRequests.declineReason,
      requestedAt: refundRequests.requestedAt,
      decidedAt: refundRequests.decidedAt,
      amountPaid: purchases.amountPaid,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      refundStatus: refunds.status,
      refundIssuedAt: refunds.issuedAt,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(refunds, eq(refunds.refundRequestId, refundRequests.id))
    .where(eq(purchases.userId, userId))
    .orderBy(desc(refundRequests.requestedAt), desc(refundRequests.id))
    .all();
}
