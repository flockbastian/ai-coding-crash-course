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

function addModule(courseId: number, position: number) {
  return testDb
    .insert(schema.modules)
    .values({ courseId, title: `Module ${position}`, position })
    .returning()
    .get();
}

function addLesson(moduleId: number, position: number, title = `Lesson ${position}`) {
  return testDb
    .insert(schema.lessons)
    .values({ moduleId, title, position })
    .returning()
    .get();
}

function addQuizOnLesson(lessonId: number, passingScore = 0.7, title = "Quiz") {
  return testDb
    .insert(schema.quizzes)
    .values({ lessonId, title, passingScore })
    .returning()
    .get();
}

/** A quiz on a fresh lesson ("<title> lesson") in a fresh module of the course. */
function addQuiz(courseId: number, passingScore = 0.7, title = "Quiz") {
  const mod = addModule(courseId, 1);
  const lesson = addLesson(mod.id, 1, `${title} lesson`);
  return addQuizOnLesson(lesson.id, passingScore, title);
}

function addAttempt(userId: number, quizId: number, score: number) {
  return testDb
    .insert(schema.quizAttempts)
    // `passed` is deliberately always false: the dashboard must judge passing
    // against the quiz's own passingScore, not the stored flag.
    .values({ userId, quizId, score, passed: false })
    .returning()
    .get();
}

/** Records one attempt per score, each by a new student. */
function addAttempts(quizId: number, scores: number[]) {
  for (const score of scores) addAttempt(addStudent().id, quizId, score);
}

function quizzesOf(
  dashboard: ReturnType<typeof getInstructorDashboard>,
  courseId: number
) {
  const course = dashboard.courses.find((c) => c.id === courseId);
  if (!course) throw new Error(`course ${courseId} not on dashboard`);
  return course.quizzes;
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

    describe("quiz breakdown", () => {
      it("counts only each student's best attempt", () => {
        const quiz = addQuiz(base.course.id, 0.7);
        const retrier = addStudent();
        addAttempt(retrier.id, quiz.id, 0.2);
        addAttempt(retrier.id, quiz.id, 0.9);
        addAttempt(retrier.id, quiz.id, 0.5);
        addAttempt(addStudent().id, quiz.id, 0.4);

        const [row] = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);

        expect(row.studentCount).toBe(2);
        expect(row.min).toBe(0.4);
        expect(row.max).toBe(0.9);
        expect(row.average).toBeCloseTo(0.65);
        expect(row.passRate).toBe(0.5);
      });

      it("keeps a student's best attempt on one quiz from counting toward another", () => {
        const first = addQuiz(base.course.id, 0.7, "First");
        const second = addQuiz(base.course.id, 0.7, "Second");
        const student = addStudent();
        addAttempt(student.id, first.id, 0.9);
        addAttempt(student.id, second.id, 0.3);

        const rows = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);
        const byId = new Map(rows.map((q) => [q.id, q]));

        expect(byId.get(first.id)).toMatchObject({ studentCount: 1, max: 0.9, passRate: 1 });
        expect(byId.get(second.id)).toMatchObject({ studentCount: 1, max: 0.3, passRate: 0 });
      });

      it("reports min, max, and average over students' best scores", () => {
        const quiz = addQuiz(base.course.id, 0.5, "Basics");
        addAttempts(quiz.id, [0.6, 1, 0.2, 0.8]);

        const [row] = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);

        expect(row).toMatchObject({
          id: quiz.id,
          title: "Basics",
          lessonTitle: "Basics lesson",
          passingScore: 0.5,
          studentCount: 4,
          min: 0.2,
          max: 1,
        });
        expect(row.average).toBeCloseTo(0.65);
      });

      it("measures pass rate against each quiz's own passing score, a score equal to it passing", () => {
        const easy = addQuiz(base.course.id, 0.5, "Easy");
        const hard = addQuiz(base.course.id, 0.9, "Hard");
        addAttempts(easy.id, [0.5, 0.6, 0.9, 0.95]);
        addAttempts(hard.id, [0.5, 0.6, 0.9, 0.95]);

        const rows = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);
        const byId = new Map(rows.map((q) => [q.id, q]));

        expect(byId.get(easy.id)?.passRate).toBe(1);
        expect(byId.get(hard.id)?.passRate).toBe(0.5);
      });

      it("flags quizzes whose pass rate is below 60%", () => {
        const atThreshold = addQuiz(base.course.id, 0.7, "At threshold");
        const below = addQuiz(base.course.id, 0.7, "Below");
        addAttempts(atThreshold.id, [0.8, 0.8, 0.8, 0.1, 0.1]); // 3 of 5 = 60%
        addAttempts(below.id, [0.8, 0.1]); // 1 of 2 = 50%

        const rows = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);
        const byId = new Map(rows.map((q) => [q.id, q]));

        expect(byId.get(atThreshold.id)?.passRate).toBe(0.6);
        expect(byId.get(atThreshold.id)?.flagged).toBe(false);
        expect(byId.get(below.id)?.flagged).toBe(true);
      });

      it("lists every quiz in course order: module position, then lesson position", () => {
        // inserted out of order so id order and position order disagree
        const second = addModule(base.course.id, 2);
        const first = addModule(base.course.id, 1);
        const q2b = addQuizOnLesson(addLesson(second.id, 2).id, 0.7, "2.2");
        const q1b = addQuizOnLesson(addLesson(first.id, 2).id, 0.7, "1.2");
        const q2a = addQuizOnLesson(addLesson(second.id, 1).id, 0.7, "2.1");
        const q1a = addQuizOnLesson(addLesson(first.id, 1).id, 0.7, "1.1");

        const rows = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);

        expect(rows.map((q) => q.id)).toEqual([q1a.id, q1b.id, q2a.id, q2b.id]);
      });

      it("returns null statistics and no flag for a quiz nobody has attempted", () => {
        const quiz = addQuiz(base.course.id, 0.7, "Untouched");

        const [row] = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);

        expect(row).toEqual({
          id: quiz.id,
          title: "Untouched",
          lessonTitle: "Untouched lesson",
          passingScore: 0.7,
          studentCount: 0,
          min: null,
          max: null,
          average: null,
          passRate: null,
          flagged: false,
          p20: null,
          p40: null,
          p60: null,
          p80: null,
        });
      });

      describe("quintiles", () => {
        // Expected values worked by hand: rank = p × (n − 1) into the sorted
        // best scores, interpolating linearly between the scores either side.

        it("gives quintiles to exactly 5 students, interpolating between neighbouring scores", () => {
          const quiz = addQuiz(base.course.id);
          addAttempts(quiz.id, [0.2, 0.4, 0.6, 0.8, 1]);

          const [row] = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);

          // ranks 0.8, 1.6, 2.4, 3.2
          expect(row.p20).toBeCloseTo(0.36, 10); // 0.2 + 0.8 × 0.2
          expect(row.p40).toBeCloseTo(0.52, 10); // 0.4 + 0.6 × 0.2
          expect(row.p60).toBeCloseTo(0.68, 10); // 0.6 + 0.4 × 0.2
          expect(row.p80).toBeCloseTo(0.84, 10); // 0.8 + 0.2 × 0.2
        });

        it("interpolates over uneven gaps, whatever order the scores were recorded in", () => {
          const quiz = addQuiz(base.course.id);
          // sorted: 0.1, 0.2, 0.4, 0.5, 0.7, 0.75, 1 (n = 7)
          addAttempts(quiz.id, [0.7, 0.1, 1, 0.4, 0.75, 0.2, 0.5]);

          const [row] = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);

          // ranks 1.2, 2.4, 3.6, 4.8
          expect(row.p20).toBeCloseTo(0.24, 10); // 0.2 + 0.2 × (0.4 − 0.2)
          expect(row.p40).toBeCloseTo(0.44, 10); // 0.4 + 0.4 × (0.5 − 0.4)
          expect(row.p60).toBeCloseTo(0.62, 10); // 0.5 + 0.6 × (0.7 − 0.5)
          expect(row.p80).toBeCloseTo(0.74, 10); // 0.7 + 0.8 × (0.75 − 0.7)
          expect(row.min).toBe(0.1);
          expect(row.max).toBe(1);
        });

        it("leaves quintiles null under 5 students but still reports min, max, average, and pass rate", () => {
          const quiz = addQuiz(base.course.id, 0.5);
          addAttempts(quiz.id, [0.6, 1, 0.2, 0.8]);

          const [row] = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);

          expect(row).toMatchObject({
            studentCount: 4,
            min: 0.2,
            max: 1,
            passRate: 0.75,
            p20: null,
            p40: null,
            p60: null,
            p80: null,
          });
          expect(row.average).toBeCloseTo(0.65);
        });

        it("counts students, not attempts, toward the 5-student minimum", () => {
          const quiz = addQuiz(base.course.id);
          const retrier = addStudent();
          addAttempt(retrier.id, quiz.id, 0.3);
          addAttempt(retrier.id, quiz.id, 0.6);
          addAttempts(quiz.id, [0.5, 0.7, 0.9]);

          const [row] = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);

          expect(row).toMatchObject({
            studentCount: 4,
            p20: null,
            p40: null,
            p60: null,
            p80: null,
          });
        });

        it("uses the score itself when the rank lands exactly on a student", () => {
          const quiz = addQuiz(base.course.id);
          addAttempts(quiz.id, [0.6, 0.1, 0.5, 0.2, 0.4, 0.3]);

          const [row] = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);

          // n = 6: ranks 1, 2, 3, 4 into 0.1, 0.2, 0.3, 0.4, 0.5, 0.6
          expect(row.p20).toBeCloseTo(0.2, 10);
          expect(row.p40).toBeCloseTo(0.3, 10);
          expect(row.p60).toBeCloseTo(0.4, 10);
          expect(row.p80).toBeCloseTo(0.5, 10);
        });

        it("handles tied scores and the 0 and 1 extremes", () => {
          const quiz = addQuiz(base.course.id);
          addAttempts(quiz.id, [1, 0, 0, 1, 0]);

          const [row] = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);

          // sorted 0, 0, 0, 1, 1; ranks 0.8, 1.6, 2.4, 3.2
          expect(row).toMatchObject({ min: 0, max: 1, p20: 0, p40: 0, p80: 1 });
          expect(row.p60).toBeCloseTo(0.4, 10); // 0 + 0.4 × (1 − 0)
        });

        it("computes quintiles from each student's best attempt only", () => {
          const quiz = addQuiz(base.course.id);
          // best scores 0.2, 0.4, 0.6, 0.8, 1 — the same as the 5-student case
          const students = [addStudent(), addStudent(), addStudent(), addStudent(), addStudent()];
          addAttempt(students[0].id, quiz.id, 0);
          addAttempt(students[0].id, quiz.id, 0.2);
          addAttempt(students[1].id, quiz.id, 0.4);
          addAttempt(students[1].id, quiz.id, 0.1);
          addAttempt(students[2].id, quiz.id, 0.05);
          addAttempt(students[2].id, quiz.id, 0.6);
          addAttempt(students[2].id, quiz.id, 0.3);
          addAttempt(students[3].id, quiz.id, 0.8);
          addAttempt(students[4].id, quiz.id, 0.15);
          addAttempt(students[4].id, quiz.id, 1);

          const [row] = quizzesOf(getInstructorDashboard(base.instructor.id), base.course.id);

          expect(row.studentCount).toBe(5);
          expect(row.p20).toBeCloseTo(0.36, 10);
          expect(row.p40).toBeCloseTo(0.52, 10);
          expect(row.p60).toBeCloseTo(0.68, 10);
          expect(row.p80).toBeCloseTo(0.84, 10);
        });
      });

      it("keeps each course's quizzes separate and leaves out out-of-scope courses' quizzes", () => {
        const archived = addCourse(base.instructor.id, schema.CourseStatus.Archived);
        const draft = addCourse(base.instructor.id, schema.CourseStatus.Draft);
        const othersCourse = addCourse(addInstructor().id, schema.CourseStatus.Published);
        const noQuizzes = addCourse(base.instructor.id, schema.CourseStatus.Published);

        const mine = addQuiz(base.course.id);
        const archivedQuiz = addQuiz(archived.id);
        const draftQuiz = addQuiz(draft.id);
        const othersQuiz = addQuiz(othersCourse.id);
        addAttempts(draftQuiz.id, [1]);
        addAttempts(othersQuiz.id, [1]);

        const dashboard = getInstructorDashboard(base.instructor.id);
        const allQuizIds = dashboard.courses.flatMap((c) => c.quizzes.map((q) => q.id));

        expect(quizzesOf(dashboard, base.course.id).map((q) => q.id)).toEqual([mine.id]);
        expect(quizzesOf(dashboard, archived.id).map((q) => q.id)).toEqual([archivedQuiz.id]);
        expect(quizzesOf(dashboard, noQuizzes.id)).toEqual([]);
        expect(allQuizIds).not.toContain(draftQuiz.id);
        expect(allQuizIds).not.toContain(othersQuiz.id);
      });
    });
  });
});
