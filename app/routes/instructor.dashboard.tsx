import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.dashboard";
import { getInstructorDashboard } from "~/services/instructorDashboardService";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  GraduationCap,
  Plus,
  Users,
} from "lucide-react";
import { CourseStatus, UserRole } from "~/db/schema";

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
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your dashboard.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (!user || user.role !== UserRole.Instructor) {
    throw data("Only instructors can access this page.", {
      status: 403,
    });
  }

  return getInstructorDashboard(currentUserId);
}

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatEarnings(cents: number): string {
  return dollars.format(cents / 100);
}

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
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
                {formatEarnings(summary.totalEarnings)}
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
                        {formatEarnings(course.earnings)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
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
