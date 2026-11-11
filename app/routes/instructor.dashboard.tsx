import { Link, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.dashboard";
import { getInstructorDashboard } from "~/services/instructorDashboardService";
import { requireInstructor } from "~/lib/access.server";
import { formatCurrency } from "~/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  GraduationCap,
  Plus,
  Users,
} from "lucide-react";
import { CourseStatus } from "~/db/schema";

export function meta() {
  return [
    { title: "Instructor Dashboard — Cadence" },
    {
      name: "description",
      content: "Earnings, students, and completion across your courses",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { userId } = await requireInstructor(request);
  return getInstructorDashboard(userId);
}

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/**
 * Floors rather than rounds, so a pass rate just under the 60% flag
 * threshold (e.g. 59.5%) never displays as "60%" next to a flag.
 */
function formatPassRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.floor(rate * 100)}%`;
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="mb-8 h-9 w-64" />
      <Skeleton className="mb-6 h-32 w-full" />
      <div className="mb-8 grid gap-6 sm:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function InstructorDashboardPage({
  loaderData,
}: Route.ComponentProps) {
  const { summary, courses } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Dashboard</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          How your published and archived courses are performing, all time
        </p>
      </div>

      {courses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <GraduationCap className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No published courses yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Stats appear here once you publish a course.
          </p>
          <Link to="/instructor/new" className="mt-4">
            <Button>
              <Plus className="mr-2 size-4" />
              Create Course
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <Card className="mb-6">
            <CardContent className="py-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <DollarSign className="size-4" />
                Total earnings
              </div>
              <div className="mt-2 text-5xl font-bold tracking-tight">
                {formatCurrency(summary.totalEarnings)}
              </div>
            </CardContent>
          </Card>

          <div className="mb-8 grid gap-6 sm:grid-cols-2">
            <Card>
              <CardContent className="py-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Users className="size-4" />
                  Students
                </div>
                <div className="mt-2 text-3xl font-bold">
                  {summary.totalEnrollments}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <CheckCircle2 className="size-4" />
                  Completion rate
                </div>
                <div className="mt-2 text-3xl font-bold">
                  {formatRate(summary.completionRate)}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {summary.completedEnrollments} of {summary.totalEnrollments}{" "}
                  enrollments completed
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Courses</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Course</th>
                    <th className="pb-2 text-right font-medium">Students</th>
                    <th className="pb-2 text-right font-medium">Completion</th>
                    <th className="pb-2 text-right font-medium">Earnings</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((course) => (
                    <tr key={course.id} className="border-b last:border-0">
                      <td className="py-3">
                        <Link
                          to={`/instructor/${course.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {course.title}
                        </Link>
                        {course.status === CourseStatus.Archived && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">
                            Archived
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {course.enrollments}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatRate(course.completionRate)}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatCurrency(course.earnings)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <h2 className="mt-10 mb-4 text-xl font-semibold">Quizzes</h2>
          <div className="space-y-4">
            {courses.map((course) => (
              <CourseQuizzes key={course.id} course={course} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type DashboardCourse = Route.ComponentProps["loaderData"]["courses"][number];

function CourseQuizzes({ course }: { course: DashboardCourse }) {
  const flaggedCount = course.quizzes.filter((q) => q.flagged).length;

  return (
    <details className="group rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-6 py-4 font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        {course.title}
        <span className="text-sm font-normal text-muted-foreground">
          {course.quizzes.length}{" "}
          {course.quizzes.length === 1 ? "quiz" : "quizzes"}
        </span>
        {flaggedCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
            <AlertTriangle className="size-3" />
            {flaggedCount} flagged
          </span>
        )}
      </summary>
      <div className="border-t px-6 py-4">
        {course.quizzes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This course has no quizzes.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 font-medium">Quiz</th>
                <th className="pb-2 text-right font-medium">Students</th>
                <th className="pb-2 text-right font-medium">Min</th>
                <th className="pb-2 text-right font-medium">Max</th>
                <th className="pb-2 text-right font-medium">Average</th>
                <th className="pb-2 text-right font-medium">Pass rate</th>
              </tr>
            </thead>
            <tbody>
              {course.quizzes.map((quiz) => (
                <tr
                  key={quiz.id}
                  className={`border-b last:border-0 ${quiz.flagged ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}
                >
                  <td className="py-3">
                    <div className="font-medium">{quiz.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {quiz.lessonTitle} · pass at{" "}
                      {formatRate(quiz.passingScore)}
                    </div>
                  </td>
                  {quiz.studentCount === 0 ? (
                    <td
                      colSpan={5}
                      className="py-3 text-right text-muted-foreground"
                    >
                      No attempts yet
                    </td>
                  ) : (
                    <>
                      <td className="py-3 text-right tabular-nums">
                        {quiz.studentCount}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatRate(quiz.min)}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatRate(quiz.max)}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatRate(quiz.average)}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {quiz.flagged ? (
                          <span
                            className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400"
                            title="Fewer than 60% of students pass this quiz"
                          >
                            <AlertTriangle className="size-3.5" />
                            {formatPassRate(quiz.passRate)}
                          </span>
                        ) : (
                          formatPassRate(quiz.passRate)
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your dashboard.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/instructor">
            <Button variant="outline">My Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
