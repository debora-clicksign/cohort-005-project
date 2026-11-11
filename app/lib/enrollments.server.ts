import { and, eq, isNull } from "drizzle-orm";
import { db } from "~/db";
import { courseRatings, enrollments } from "~/db/schema";

// ─── Enrollments ───
// The one answer to "does this learner have access to this course?". A
// Refunded Enrollment keeps its row (see docs/adr/0001) but gives no access, so
// nothing outside this module should read `enrollments` to decide access or to
// count a course's learners — use `activeEnrollment` in the where clause.

/** Matches Active and Completed Enrollments — the ones that give access. */
export const activeEnrollment = isNull(enrollments.refundedAt);

/**
 * Left-join `enrollments` on this, then filter with `activeEnrollment`, to
 * leave a Refunded Enrollment's rating out of an average while keeping it.
 */
export const ratingEnrollment = and(
  eq(enrollments.userId, courseRatings.userId),
  eq(enrollments.courseId, courseRatings.courseId)
);

export function findEnrollment(userId: number, courseId: number) {
  return db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

export function isUserEnrolled(userId: number, courseId: number) {
  const enrollment = findEnrollment(userId, courseId);
  return !!enrollment && enrollment.refundedAt === null;
}

/**
 * Gives the learner access. Buying again after a Refund brings the same
 * Enrollment back rather than adding a second one, so earlier progress returns.
 */
export function enrollLearner(userId: number, courseId: number) {
  const existing = findEnrollment(userId, courseId);

  if (!existing) {
    return db
      .insert(enrollments)
      .values({ userId, courseId })
      .returning()
      .get();
  }

  if (existing.refundedAt === null) {
    throw new Error("User is already enrolled in this course");
  }

  return db
    .update(enrollments)
    .set({ refundedAt: null, enrolledAt: new Date().toISOString() })
    .where(eq(enrollments.id, existing.id))
    .returning()
    .get();
}
