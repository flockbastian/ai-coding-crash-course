import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { CourseStatus, courses, enrollments, purchases } from "~/db/schema";

// ─── Instructor Dashboard Service ───
// Aggregates earnings and enrollment stats across an instructor's courses.

export function getInstructorDashboard(instructorId: number) {
  const instructorCourses = db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
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

  const rows = instructorCourses.map((course) => {
    const counts = enrollmentsByCourse.get(course.id);
    const total = counts?.total ?? 0;
    const completed = counts?.completed ?? 0;
    return {
      ...course,
      earnings: earningsByCourse.get(course.id) ?? 0,
      enrollments: total,
      completedEnrollments: completed,
      completionRate: rate(completed, total),
    };
  });

  const totalEarnings = rows.reduce((sum, c) => sum + c.earnings, 0);
  const totalEnrollments = rows.reduce((sum, c) => sum + c.enrollments, 0);
  const completedEnrollments = rows.reduce(
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
    courses: rows,
  };
}

/** completed ÷ total, or null when there is nothing to divide by. */
function rate(completed: number, total: number): number | null {
  return total === 0 ? null : completed / total;
}
