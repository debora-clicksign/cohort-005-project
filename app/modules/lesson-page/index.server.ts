/**
 * Server data for the Lesson page: the course outline, progress, the
 * discussion thread and quizzes.
 */
export {
  getCourseWithDetails,
  getLessonById,
  getModuleById,
  getUserById,
  flattenCourseLessons,
} from "./lib/course.server";
export {
  getLessonProgress,
  getLessonProgressForCourse,
  markLessonComplete,
  markLessonInProgress,
  getLastWatchPosition,
  calculateWatchProgress,
} from "./lib/progress.server";
export {
  getCommentById,
  getLessonThread,
  renderThread,
} from "./lib/thread.server";
export {
  getQuizByLessonId,
  getQuizWithQuestions,
  getBestAttempt,
  computeResult,
} from "./lib/quiz.server";
export {
  createCommentSchema,
  editCommentSchema,
  saveNoteSchema,
  deleteCommentSchema,
} from "./lib/action-schemas";
