import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  approveRefundRequest,
  declineRefundRequest,
  getOnHoldRevenueByCourse,
  getRefundEligibility,
  getRefundedRevenueByBucket,
  getRefundedRevenueByCourse,
  listDecidedRefundRequests,
  listLearnerRefundRequests,
  listOpenRefundRequests,
  listUnsentRefunds,
  markRefundFailed,
  markRefundIssued,
  requestRefund,
} from "./refunds.server";
import { enrollLearner, isUserEnrolled } from "./enrollments.server";

const REASON = "This course was not what I expected it to be.";

function daysAgo(days: number) {
  const when = new Date();
  when.setDate(when.getDate() - days);
  return when.toISOString();
}

function rejectionStatus(run: () => unknown): number | null {
  try {
    run();
  } catch (error) {
    if (typeof error === "object" && error !== null && "init" in error) {
      const init = (error as { init: ResponseInit | null }).init;
      return init?.status ?? null;
    }
    throw error;
  }
  throw new Error("Expected the call to be rejected");
}

let base: ReturnType<typeof seedBaseData>;
let admin: typeof schema.users.$inferSelect;
let lessonIds: number[];
let sentEmails: string[];

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);

  admin = testDb
    .insert(schema.users)
    .values({ name: "Ada Admin", email: "admin@example.com", role: schema.UserRole.Admin })
    .returning()
    .get();

  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3, 4].map(
    (position) =>
      testDb
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );

  sentEmails = [];
  vi.spyOn(console, "log").mockImplementation((message: string) => {
    sentEmails.push(message);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function buyCourse(userId: number, options: { daysAgo?: number; amountPaid?: number } = {}) {
  const purchase = testDb
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid: options.amountPaid ?? 4999,
      createdAt: daysAgo(options.daysAgo ?? 1),
    })
    .returning()
    .get();
  enrollLearner(userId, base.course.id);
  return purchase;
}

function completeLessons(userId: number, count: number) {
  for (const lessonId of lessonIds.slice(0, count)) {
    testDb
      .insert(schema.lessonProgress)
      .values({ userId, lessonId, status: schema.LessonProgressStatus.Completed })
      .run();
  }
}

function openRequest() {
  buyCourse(base.user.id);
  return requestRefund(base.user.id, base.course.id, REASON);
}

describe("Refund Eligibility", () => {
  it("lets a learner who bought recently and watched little ask for the full amount", () => {
    buyCourse(base.user.id, { amountPaid: 2500 });

    expect(getRefundEligibility(base.user.id, base.course.id)).toMatchObject({
      eligible: true,
      amount: 2500,
    });
  });

  it("keeps the window open through the whole fourteenth day, and closes it on the fifteenth", () => {
    buyCourse(base.user.id, { daysAgo: 0 });
    const day = (offset: number) => {
      const when = new Date();
      when.setDate(when.getDate() + offset);
      return when;
    };

    expect(getRefundEligibility(base.user.id, base.course.id, day(14)).eligible).toBe(true);
    expect(getRefundEligibility(base.user.id, base.course.id, day(15))).toMatchObject({
      eligible: false,
      status: 403,
    });
  });

  it("rejects a direct request from a learner who completed half the lessons", () => {
    buyCourse(base.user.id);
    completeLessons(base.user.id, 2);

    expect(rejectionStatus(() => requestRefund(base.user.id, base.course.id, REASON))).toBe(403);
  });

  it("rejects a learner who has watched two hours", () => {
    buyCourse(base.user.id);
    testDb
      .insert(schema.videoWatchEvents)
      .values([
        { userId: base.user.id, lessonId: lessonIds[0], eventType: "pause", positionSeconds: 3600 },
        { userId: base.user.id, lessonId: lessonIds[1], eventType: "pause", positionSeconds: 3600 },
      ])
      .run();

    expect(rejectionStatus(() => requestRefund(base.user.id, base.course.id, REASON))).toBe(403);
  });

  it("allows only one Open Refund Request per purchase", () => {
    openRequest();

    expect(rejectionStatus(() => requestRefund(base.user.id, base.course.id, REASON))).toBe(409);
  });

  it("rejects a Team Licence once any seat has been claimed", () => {
    const purchase = testDb
      .insert(schema.purchases)
      .values({ userId: base.user.id, courseId: base.course.id, amountPaid: 9998 })
      .returning()
      .get();
    const team = testDb.insert(schema.teams).values({}).returning().get();
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: "SEAT-1",
        purchaseId: purchase.id,
        redeemedAt: new Date().toISOString(),
      })
      .run();

    expect(getRefundEligibility(base.user.id, base.course.id)).toMatchObject({
      eligible: false,
      status: 403,
    });
  });

  it("does not let a learner be refunded twice for the same course", () => {
    const request = openRequest();
    approveRefundRequest(request.id, admin.id);

    buyCourse(base.user.id);

    expect(getRefundEligibility(base.user.id, base.course.id)).toMatchObject({
      eligible: false,
      status: 403,
    });
  });
});

describe("approving a Refund Request", () => {
  it("starts a Pending Refund for the full amount and ends the learner's access", () => {
    const request = openRequest();

    const refund = approveRefundRequest(request.id, admin.id);

    expect(refund).toMatchObject({ amount: 4999, status: schema.RefundStatus.Pending });
    expect(isUserEnrolled(base.user.id, base.course.id)).toBe(false);
    expect(listOpenRefundRequests()).toEqual([]);
    expect(sentEmails.some((email) => email.includes("Refund approved"))).toBe(true);
  });

  it("is allowed even if the learner stopped being eligible after asking", () => {
    const request = openRequest();
    completeLessons(base.user.id, 4);

    expect(approveRefundRequest(request.id, admin.id).status).toBe(schema.RefundStatus.Pending);
  });

  it("tells the second admin it was already decided, and refunds only once", () => {
    const request = openRequest();
    approveRefundRequest(request.id, admin.id);

    expect(rejectionStatus(() => approveRefundRequest(request.id, admin.id))).toBe(409);
    expect(rejectionStatus(() => declineRefundRequest(request.id, admin.id, "No."))).toBe(409);
    expect(listUnsentRefunds()).toHaveLength(1);
  });

  it("stops the Team Licence's unclaimed Seat Codes from working", () => {
    const purchase = testDb
      .insert(schema.purchases)
      .values({ userId: base.user.id, courseId: base.course.id, amountPaid: 9998 })
      .returning()
      .get();
    const team = testDb.insert(schema.teams).values({}).returning().get();
    testDb
      .insert(schema.coupons)
      .values([
        { teamId: team.id, courseId: base.course.id, code: "SEAT-1", purchaseId: purchase.id },
        { teamId: team.id, courseId: base.course.id, code: "SEAT-2", purchaseId: purchase.id },
      ])
      .run();
    const request = requestRefund(base.user.id, base.course.id, REASON);

    approveRefundRequest(request.id, admin.id);

    const seats = testDb.select().from(schema.coupons).all();
    expect(seats.every((seat) => seat.voidedAt !== null)).toBe(true);
  });
});

describe("declining a Refund Request", () => {
  it("tells the learner why, keeps their access, and lets them ask again", () => {
    const request = openRequest();

    declineRefundRequest(request.id, admin.id, "Please tell us which lesson was the problem.");

    expect(isUserEnrolled(base.user.id, base.course.id)).toBe(true);
    expect(
      sentEmails.some((email) => email.includes("Please tell us which lesson was the problem."))
    ).toBe(true);
    expect(getRefundEligibility(base.user.id, base.course.id).eligible).toBe(true);
    expect(listDecidedRefundRequests()[0]).toMatchObject({
      status: schema.RefundRequestStatus.Declined,
      decidedByName: "Ada Admin",
      refundStatus: null,
    });
  });
});

describe("sending a Refund", () => {
  it("marks a Pending Refund Issued and emails the learner", () => {
    const refund = approveRefundRequest(openRequest().id, admin.id);

    markRefundIssued(refund.id, admin.id);

    expect(listUnsentRefunds()).toEqual([]);
    expect(sentEmails.some((email) => email.includes("Refund sent"))).toBe(true);
  });

  it("keeps a Failed Refund owed until an admin retries and marks it Issued", () => {
    const refund = approveRefundRequest(openRequest().id, admin.id);

    markRefundFailed(refund.id, admin.id);
    expect(listUnsentRefunds()[0]).toMatchObject({ status: schema.RefundStatus.Failed });
    expect(isUserEnrolled(base.user.id, base.course.id)).toBe(false);

    markRefundIssued(refund.id, admin.id);
    expect(listUnsentRefunds()).toEqual([]);
  });

  it("refuses to issue twice, or to fail an Issued Refund", () => {
    const refund = approveRefundRequest(openRequest().id, admin.id);
    markRefundIssued(refund.id, admin.id);

    expect(rejectionStatus(() => markRefundIssued(refund.id, admin.id))).toBe(409);
    expect(rejectionStatus(() => markRefundFailed(refund.id, admin.id))).toBe(409);
  });
});

describe("after a Refund", () => {
  it("brings back the same Enrollment, with its progress, when the learner buys again", () => {
    buyCourse(base.user.id);
    completeLessons(base.user.id, 1);
    const request = requestRefund(base.user.id, base.course.id, REASON);
    approveRefundRequest(request.id, admin.id);

    buyCourse(base.user.id);

    expect(isUserEnrolled(base.user.id, base.course.id)).toBe(true);
    expect(testDb.select().from(schema.enrollments).all()).toHaveLength(1);
    expect(testDb.select().from(schema.lessonProgress).all()).toHaveLength(1);
  });

  it("shows the learner every request with its state", () => {
    const first = openRequest();
    declineRefundRequest(first.id, admin.id, "Not yet.");
    const second = requestRefund(base.user.id, base.course.id, REASON);
    approveRefundRequest(second.id, admin.id);

    expect(listLearnerRefundRequests(base.user.id)).toMatchObject([
      { status: schema.RefundRequestStatus.Approved, refundStatus: schema.RefundStatus.Pending },
      { status: schema.RefundRequestStatus.Declined, declineReason: "Not yet." },
    ]);
  });
});

describe("instructor revenue", () => {
  it("holds money from the moment a request opens until the Refund is Issued", () => {
    const request = openRequest();
    expect(getOnHoldRevenueByCourse(null, null).get(base.course.id)).toBe(4999);

    const refund = approveRefundRequest(request.id, admin.id);
    markRefundFailed(refund.id, admin.id);
    expect(getOnHoldRevenueByCourse(null, null).get(base.course.id)).toBe(4999);
    expect(getRefundedRevenueByCourse(null, null).size).toBe(0);

    markRefundIssued(refund.id, admin.id);
    expect(getOnHoldRevenueByCourse(null, null).size).toBe(0);
    expect(getRefundedRevenueByCourse(null, null).get(base.course.id)).toBe(4999);
  });

  it("releases the hold when the request is declined", () => {
    const request = openRequest();

    declineRefundRequest(request.id, admin.id, "Not this time, sorry.");

    expect(getOnHoldRevenueByCourse(null, null).size).toBe(0);
  });

  it("counts a Refund in the period it was Issued, not the period of the sale", () => {
    buyCourse(base.user.id, { daysAgo: 10 });
    const request = requestRefund(base.user.id, base.course.id, REASON);
    const refund = approveRefundRequest(request.id, admin.id);
    markRefundIssued(refund.id, admin.id);

    const today = new Date().toISOString();
    const issuedDay = today.slice(0, 10);

    expect(getRefundedRevenueByCourse(null, daysAgo(1)).get(base.course.id)).toBe(4999);
    expect(getRefundedRevenueByBucket(null, null, 10).get(issuedDay)).toBe(4999);
    expect(getOnHoldRevenueByCourse(null, daysAgo(1)).size).toBe(0);
  });

  it("only counts the instructor's own courses", () => {
    openRequest();

    expect(getOnHoldRevenueByCourse(admin.id, null).size).toBe(0);
    expect(getOnHoldRevenueByCourse(base.instructor.id, null).get(base.course.id)).toBe(4999);
  });
});

describe("the admin's view of an Open Refund Request", () => {
  it("shows days left in the window, hours watched and lessons completed", () => {
    buyCourse(base.user.id, { daysAgo: 4 });
    completeLessons(base.user.id, 1);
    testDb
      .insert(schema.videoWatchEvents)
      .values({
        userId: base.user.id,
        lessonId: lessonIds[0],
        eventType: "pause",
        positionSeconds: 1800,
      })
      .run();
    requestRefund(base.user.id, base.course.id, REASON);

    expect(listOpenRefundRequests()[0]).toMatchObject({
      daysLeftInWindow: 10,
      hoursWatched: 0.5,
      lessonsCompleted: 1,
      lessonCount: 4,
      amountPaid: 4999,
    });
  });
});
