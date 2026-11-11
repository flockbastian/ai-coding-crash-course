import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  courses,
  enrollments,
  lessons,
  modules,
  purchases,
  quizAttempts,
  quizzes,
} from "~/db/schema";

// ─── Instructor Dashboard Service ───
// Aggregates earnings, enrollment, and quiz stats across an instructor's
// published and archived courses, for the instructor dashboard.
// Uses positional parameters (project convention).

/** Quizzes whose pass rate falls below this are flagged as problem quizzes. */
const FLAG_PASS_RATE = 0.6;

export function getInstructorDashboard(instructorId: number) {
  const instructorCourses = db
    .select({
      id: courses.id,
      title: courses.title,
      status: courses.status,
    })
    .from(courses)
    .where(
      and(
        eq(courses.instructorId, instructorId),
        inArray(courses.status, [CourseStatus.Published, CourseStatus.Archived])
      )
    )
    .all();

  const courseIds = instructorCourses.map((c) => c.id);

  const earningsByCourse = new Map(
    db
      .select({
        courseId: purchases.courseId,
        earnings: sql<number>`sum(${purchases.amountPaid})`,
      })
      .from(purchases)
      .where(inArray(purchases.courseId, courseIds))
      .groupBy(purchases.courseId)
      .all()
      .map((r) => [r.courseId, r.earnings])
  );

  const enrollmentsByCourse = new Map(
    db
      .select({
        courseId: enrollments.courseId,
        total: sql<number>`count(*)`,
        completed: sql<number>`count(${enrollments.completedAt})`,
      })
      .from(enrollments)
      .where(inArray(enrollments.courseId, courseIds))
      .groupBy(enrollments.courseId)
      .all()
      .map((r) => [r.courseId, r])
  );

  const quizzesByCourse = getQuizStatsByCourse(courseIds);

  const courseStats = instructorCourses.map((course) => {
    const counts = enrollmentsByCourse.get(course.id);
    const total = counts?.total ?? 0;
    const completed = counts?.completed ?? 0;
    return {
      ...course,
      earnings: earningsByCourse.get(course.id) ?? 0,
      enrollments: total,
      completedEnrollments: completed,
      completionRate: rate(completed, total),
      quizzes: quizzesByCourse.get(course.id) ?? [],
    };
  });

  const totalEarnings = courseStats.reduce((sum, c) => sum + c.earnings, 0);
  const totalEnrollments = courseStats.reduce((sum, c) => sum + c.enrollments, 0);
  const completedEnrollments = courseStats.reduce(
    (sum, c) => sum + c.completedEnrollments,
    0
  );

  return {
    summary: {
      totalEarnings,
      totalEnrollments,
      completedEnrollments,
      completionRate: rate(completedEnrollments, totalEnrollments),
    },
    courses: courseStats,
  };
}

/** completed ÷ total, or null when there is nothing to divide by. */
function rate(completed: number, total: number): number | null {
  return total === 0 ? null : completed / total;
}

/**
 * Every quiz in the given courses, in course order (module position, then
 * lesson position), with stats over each student's best attempt.
 */
function getQuizStatsByCourse(courseIds: number[]) {
  const courseQuizzes = db
    .select({
      id: quizzes.id,
      title: quizzes.title,
      lessonTitle: lessons.title,
      passingScore: quizzes.passingScore,
      courseId: modules.courseId,
    })
    .from(quizzes)
    .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(inArray(modules.courseId, courseIds))
    .orderBy(asc(modules.position), asc(lessons.position), asc(quizzes.id))
    .all();

  const bestScoresByQuiz = new Map<number, number[]>();
  const bestAttempts = db
    .select({
      quizId: quizAttempts.quizId,
      best: max(quizAttempts.score).mapWith(Number),
    })
    .from(quizAttempts)
    .where(
      inArray(
        quizAttempts.quizId,
        courseQuizzes.map((q) => q.id)
      )
    )
    .groupBy(quizAttempts.quizId, quizAttempts.userId)
    .all();
  for (const { quizId, best } of bestAttempts) {
    const scores = bestScoresByQuiz.get(quizId) ?? [];
    scores.push(best);
    bestScoresByQuiz.set(quizId, scores);
  }

  const byCourse = new Map<number, QuizStats[]>();
  for (const { courseId, ...quiz } of courseQuizzes) {
    const stats = quizStats(quiz, bestScoresByQuiz.get(quiz.id) ?? []);
    const list = byCourse.get(courseId) ?? [];
    list.push(stats);
    byCourse.set(courseId, list);
  }
  return byCourse;
}

type QuizInfo = {
  id: number;
  title: string;
  lessonTitle: string;
  passingScore: number;
};

export type QuizStats = QuizInfo & {
  studentCount: number;
  min: number | null;
  max: number | null;
  average: number | null;
  passRate: number | null;
  flagged: boolean;
};

/** Stats over one best score (0–1) per student; null stats when there are none. */
function quizStats(quiz: QuizInfo, bestScores: number[]): QuizStats {
  const studentCount = bestScores.length;
  if (studentCount === 0) {
    return {
      ...quiz,
      studentCount,
      min: null,
      max: null,
      average: null,
      passRate: null,
      flagged: false,
    };
  }

  const sorted = [...bestScores].sort((a, b) => a - b);
  const passing = sorted.filter((s) => s >= quiz.passingScore).length;
  const passRate = passing / studentCount;
  return {
    ...quiz,
    studentCount,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    average: sorted.reduce((sum, s) => sum + s, 0) / studentCount,
    passRate,
    flagged: passRate < FLAG_PASS_RATE,
  };
}
