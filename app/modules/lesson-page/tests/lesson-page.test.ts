import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { LessonProgressStatus } from "~/db/schema";
import {
  calculateWatchProgress,
  createCommentSchema,
  deleteCommentSchema,
  editCommentSchema,
  flattenCourseLessons,
  getCourseWithDetails,
  getLessonProgress,
  getLessonProgressForCourse,
  getLessonQuiz,
  markLessonComplete,
  markLessonInProgress,
  saveNoteSchema,
  submitQuizSchema,
} from "../index.server";

// The module reads the app's shared `db`; point it at a fresh in-memory one.
const testDb = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("~/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_target, prop) => {
        const target = testDb.current as TestDb;
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }
  ),
}));

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

function addModule(title: string, position: number) {
  return db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title, position })
    .returning()
    .get();
}

function addLesson(moduleId: number, title: string, position: number) {
  return db
    .insert(schema.lessons)
    .values({ moduleId, title, position })
    .returning()
    .get();
}

beforeEach(() => {
  db = createTestDb();
  testDb.current = db;
  base = seedBaseData(db);
  const second = addModule("Generics", 2);
  const first = addModule("Basics", 1);
  lessonIds = [
    addLesson(first.id, "Hello", 1).id,
    addLesson(first.id, "Types", 2).id,
    addLesson(second.id, "Generic functions", 1).id,
  ];
});

describe("the course outline", () => {
  it("lists modules and lessons in order, with the instructor's name", () => {
    const course = getCourseWithDetails(base.course.id);
    expect(course?.instructorName).toBe("Test Instructor");
    expect(
      course?.modules.map((m) => [m.title, m.lessons.map((l) => l.title)])
    ).toEqual([
      ["Basics", ["Hello", "Types"]],
      ["Generics", ["Generic functions"]],
    ]);
  });

  it("is null for a course that does not exist", () => {
    expect(getCourseWithDetails(9999)).toBeNull();
  });

  it("flattens to one list for previous and next", () => {
    const course = getCourseWithDetails(base.course.id);
    if (!course) throw new Error("course missing");
    expect(
      flattenCourseLessons(course).map((l) => [l.title, l.moduleTitle])
    ).toEqual([
      ["Hello", "Basics"],
      ["Types", "Basics"],
      ["Generic functions", "Generics"],
    ]);
  });
});

describe("lesson progress", () => {
  const NOW = new Date("2026-03-01T12:00:00.000Z");

  it("marks a viewed lesson in progress", () => {
    markLessonInProgress(base.user.id, lessonIds[0]);
    expect(getLessonProgress(base.user.id, lessonIds[0])?.status).toBe(
      LessonProgressStatus.InProgress
    );
  });

  it("does not move a completed lesson back to in progress", () => {
    markLessonComplete(base.user.id, lessonIds[0], NOW);
    markLessonInProgress(base.user.id, lessonIds[0]);
    expect(getLessonProgress(base.user.id, lessonIds[0])?.status).toBe(
      LessonProgressStatus.Completed
    );
  });

  it("completes a lesson already in progress without a second row", () => {
    markLessonInProgress(base.user.id, lessonIds[1]);
    markLessonComplete(base.user.id, lessonIds[1], NOW);
    const rows = getLessonProgressForCourse(base.user.id, base.course.id);
    expect(rows.map((r) => [r.lessonId, r.status, r.completedAt])).toEqual([
      [lessonIds[1], LessonProgressStatus.Completed, NOW.toISOString()],
    ]);
  });
});

describe("watch progress", () => {
  function watchedTo(positionSeconds: number) {
    db.insert(schema.videoWatchEvents)
      .values({
        userId: base.user.id,
        lessonId: lessonIds[0],
        eventType: "progress",
        positionSeconds,
      })
      .run();
  }

  it("is the furthest point watched, as a percentage", () => {
    watchedTo(30);
    watchedTo(90);
    watchedTo(60);
    expect(calculateWatchProgress(base.user.id, lessonIds[0], 360)).toBe(25);
  });

  it("stops at 100", () => {
    watchedTo(500);
    expect(calculateWatchProgress(base.user.id, lessonIds[0], 360)).toBe(100);
  });
});

describe("a lesson's quiz", () => {
  it("is found by id on its own lesson, and not on another", () => {
    const quiz = db
      .insert(schema.quizzes)
      .values({ lessonId: lessonIds[0], title: "Basics", passingScore: 0.7 })
      .returning()
      .get();
    expect(getLessonQuiz(quiz.id, lessonIds[0])).toEqual(quiz);
    expect(getLessonQuiz(quiz.id, lessonIds[1])).toBeUndefined();
  });
});

describe("the submit-quiz form", () => {
  const parse = (fields: Record<string, string>) =>
    submitQuizSchema.safeParse(fields);

  it("reads the quiz id as a number", () => {
    expect(parse({ intent: "submit-quiz", quizId: "3" })).toMatchObject({
      success: true,
      data: { intent: "submit-quiz", quizId: 3 },
    });
  });

  it.each(["", "abc", "0", "1.5"])("rejects quiz id %j", (quizId) => {
    expect(parse({ intent: "submit-quiz", quizId }).success).toBe(false);
  });

  it("rejects another intent", () => {
    expect(parse({ intent: "save-note", quizId: "3" }).success).toBe(false);
  });
});

describe("the save-note form", () => {
  const parse = (body: string) => saveNoteSchema.safeParse({ body });
  const errorOf = (body: string) => parse(body).error?.issues[0]?.message;

  it("saves the body trimmed", () => {
    expect(parse("  Rewatch at 4:20 \n").data).toEqual({
      body: "Rewatch at 4:20",
    });
  });

  it("rejects a body that is only whitespace", () => {
    expect(errorOf("   ")).toBe("Write something before saving your note.");
  });

  it("allows 2,000 characters after trimming, and not 2,001", () => {
    expect(parse(` ${"a".repeat(2000)} `).success).toBe(true);
    expect(errorOf("a".repeat(2001))).toBe(
      "Your note is over 2,000 characters, so it was not saved."
    );
  });
});

describe("the comment forms", () => {
  it("each accepts only its own intent", () => {
    expect(
      createCommentSchema.safeParse({ intent: "create-comment", body: "Hi" })
        .success
    ).toBe(true);
    expect(
      createCommentSchema.safeParse({ intent: "edit-comment", body: "Hi" })
        .success
    ).toBe(false);
    expect(
      editCommentSchema.safeParse({
        intent: "edit-comment",
        commentId: "4",
        body: "Hi",
      }).data
    ).toEqual({ intent: "edit-comment", commentId: 4, body: "Hi" });
    expect(
      editCommentSchema.safeParse({
        intent: "create-comment",
        commentId: "4",
        body: "Hi",
      }).success
    ).toBe(false);
    expect(
      deleteCommentSchema.safeParse({
        intent: "delete-comment",
        commentId: "4",
      }).data
    ).toEqual({ intent: "delete-comment", commentId: 4 });
    expect(
      deleteCommentSchema.safeParse({ intent: "edit-comment", commentId: "4" })
        .success
    ).toBe(false);
  });
});
