import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import { getInstructorDashboard } from "./instructorDashboardService";
import { createTeamPurchase } from "./purchaseService";
import { redeemCoupon } from "./couponService";
import { enrollUser, markEnrollmentComplete } from "./enrollmentService";

let userCounter = 0;

function addStudent() {
  userCounter++;
  return testDb
    .insert(schema.users)
    .values({
      name: `Student ${userCounter}`,
      email: `student${userCounter}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

function addInstructor() {
  userCounter++;
  return testDb
    .insert(schema.users)
    .values({
      name: `Instructor ${userCounter}`,
      email: `instructor${userCounter}@example.com`,
      role: schema.UserRole.Instructor,
    })
    .returning()
    .get();
}

let courseCounter = 0;

function addCourse(instructorId: number, status: schema.CourseStatus) {
  courseCounter++;
  return testDb
    .insert(schema.courses)
    .values({
      title: `Course ${courseCounter}`,
      slug: `course-${courseCounter}`,
      description: "A course",
      salesCopy: "Sales copy",
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

function addPurchase(
  userId: number,
  courseId: number,
  amountPaid: number,
  country: string | null = null
) {
  return testDb
    .insert(schema.purchases)
    .values({ userId, courseId, amountPaid, country })
    .returning()
    .get();
}

describe("instructorDashboardService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getInstructorDashboard", () => {
    it("sums what students paid into the course's earnings and the total", () => {
      addPurchase(addStudent().id, base.course.id, 4999);
      addPurchase(addStudent().id, base.course.id, 2500);

      const dashboard = getInstructorDashboard(base.instructor.id);

      expect(dashboard.summary.totalEarnings).toBe(7499);
      expect(dashboard.courses).toHaveLength(1);
      expect(dashboard.courses[0].id).toBe(base.course.id);
      expect(dashboard.courses[0].earnings).toBe(7499);
    });

    it("counts PPP-discounted purchases at the reduced amount actually paid", () => {
      // list price 9999; a purchase from India at the PPP price
      addPurchase(addStudent().id, base.course.id, 9999, "US");
      addPurchase(addStudent().id, base.course.id, 3000, "IN");

      const dashboard = getInstructorDashboard(base.instructor.id);

      expect(dashboard.courses[0].earnings).toBe(12999);
    });

    it("includes published and archived courses but not drafts or other instructors' courses", () => {
      const archived = addCourse(base.instructor.id, schema.CourseStatus.Archived);
      const draft = addCourse(base.instructor.id, schema.CourseStatus.Draft);
      const otherInstructor = addInstructor();
      const othersCourse = addCourse(otherInstructor.id, schema.CourseStatus.Published);

      addPurchase(addStudent().id, archived.id, 1000);
      addPurchase(addStudent().id, draft.id, 2000);
      addPurchase(addStudent().id, othersCourse.id, 4000);

      const dashboard = getInstructorDashboard(base.instructor.id);

      expect(dashboard.courses.map((c) => c.id).sort()).toEqual(
        [base.course.id, archived.id].sort()
      );
      expect(dashboard.summary.totalEarnings).toBe(1000);
    });

    it("counts a team purchase once at the amount paid, however many seats it bought", () => {
      createTeamPurchase(addStudent().id, base.course.id, 30000, null, 10);

      const dashboard = getInstructorDashboard(base.instructor.id);

      expect(dashboard.courses[0].earnings).toBe(30000);
      expect(dashboard.summary.totalEarnings).toBe(30000);
    });

    it("returns no courses and zeroed totals for an instructor with nothing published", () => {
      addCourse(base.instructor.id, schema.CourseStatus.Draft);
      const newInstructor = addInstructor();

      const dashboard = getInstructorDashboard(newInstructor.id);

      expect(dashboard.courses).toEqual([]);
      expect(dashboard.summary).toEqual({
        totalEarnings: 0,
        totalEnrollments: 0,
        completedEnrollments: 0,
        completionRate: null,
      });
    });

    it("counts direct and coupon-redeemed enrollments as students", () => {
      enrollUser(addStudent().id, base.course.id, false, false);
      enrollUser(addStudent().id, base.course.id, false, false);
      const buyer = addStudent();
      const { coupons } = createTeamPurchase(buyer.id, base.course.id, 30000, null, 5);
      redeemCoupon(coupons[0].code, addStudent().id, "US");

      const dashboard = getInstructorDashboard(base.instructor.id);

      // 3 enrollments; the 4 unredeemed seats are not students
      expect(dashboard.courses[0].enrollments).toBe(3);
      expect(dashboard.summary.totalEnrollments).toBe(3);
    });

    it("reports completion rate per course and weighted by enrollment overall", () => {
      // base.course: 4 enrolled, 1 completed → 25%
      const students = [addStudent(), addStudent(), addStudent(), addStudent()];
      for (const s of students) enrollUser(s.id, base.course.id, false, false);
      markEnrollmentComplete(students[0].id, base.course.id);

      // second course: 1 enrolled, 1 completed → 100%
      const small = addCourse(base.instructor.id, schema.CourseStatus.Published);
      const finisher = addStudent();
      enrollUser(finisher.id, small.id, false, false);
      markEnrollmentComplete(finisher.id, small.id);

      // third course: nobody enrolled → no rate
      const empty = addCourse(base.instructor.id, schema.CourseStatus.Published);

      const dashboard = getInstructorDashboard(base.instructor.id);
      const byId = new Map(dashboard.courses.map((c) => [c.id, c]));

      expect(byId.get(base.course.id)?.completedEnrollments).toBe(1);
      expect(byId.get(base.course.id)?.completionRate).toBe(0.25);
      expect(byId.get(small.id)?.completionRate).toBe(1);
      expect(byId.get(empty.id)?.completionRate).toBeNull();

      // 2 of 5 enrollments completed — not the 62.5% mean of course rates
      expect(dashboard.summary.completedEnrollments).toBe(2);
      expect(dashboard.summary.completionRate).toBe(0.4);
    });

    it("has a null overall completion rate when no one is enrolled", () => {
      const dashboard = getInstructorDashboard(base.instructor.id);

      expect(dashboard.summary.totalEnrollments).toBe(0);
      expect(dashboard.summary.completionRate).toBeNull();
    });
  });
});
