"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { teacher, type TeacherCourse } from "@/lib/api";
import { Button, useToast } from "@/components/ui";

export default function CourseListPage() {
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("math");
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const reload = () => {
    setLoading(true);
    teacher.courses().then((d) => setCourses(d.courses)).finally(() => setLoading(false));
  };

  useEffect(() => {
    teacher.courses().then((d) => setCourses(d.courses)).finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await teacher.createCourse({ name: name.trim(), subject });
      setName("");
      setSubject("math");
      setShowCreate(false);
      reload();
      toast.success("Course created");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">Courses</h1>
          <p className="mt-0.5 text-sm text-text-muted">Manage your courses and class sections.</p>
        </div>
        {!showCreate && (
          <Button onClick={() => setShowCreate(true)} gradient>
            + New Course
          </Button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-text-primary">New Course</h2>
            <button onClick={() => setShowCreate(false)} className="text-sm font-medium text-text-muted hover:text-text-secondary">
              Cancel
            </button>
          </div>
          <form onSubmit={handleCreate} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="text-[13px] font-semibold text-text-secondary">Course Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Algebra I"
                  required
                  className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-primary"
                />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-text-secondary">Subject</label>
                <select
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                >
                  <option value="math">Math</option>
                  <option value="chemistry">Chemistry</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={creating} gradient>
                Create Course
              </Button>
            </div>
          </form>
        </motion.div>
      )}

      {/* Course list */}
      <div className="mt-6 space-y-3">
        {loading ? (
          <div className="py-12 text-center text-text-muted">Loading courses...</div>
        ) : courses.length === 0 ? (
          <div className="rounded-[--radius-xl] border border-dashed border-border bg-surface p-12 text-center">
            <p className="text-lg font-semibold text-text-primary">No courses yet</p>
            <p className="mt-1 text-sm text-text-muted">
              Click &quot;+ New Course&quot; to create your first course.
            </p>
          </div>
        ) : (
          courses.map((course, i) => (
            <motion.div
              key={course.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Link
                href={`/teacher/courses/${course.id}`}
                className="flex items-center justify-between rounded-[--radius-lg] border border-border-light bg-surface p-5 transition-colors hover:border-primary/30 hover:bg-primary-bg/20"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-text-primary">{course.name}</h3>
                    <span className={`rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      course.status === "published"
                        ? "bg-green-50 text-green-600 dark:bg-green-500/10"
                        : "bg-amber-50 text-amber-600 dark:bg-amber-500/10"
                    }`}>
                      {course.status}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-3 text-xs text-text-muted">
                    <span className="capitalize">{course.subject}</span>
                    <span>{course.section_count} section{course.section_count !== 1 ? "s" : ""}</span>
                    <span>{course.doc_count} document{course.doc_count !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <svg className="h-5 w-5 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </Link>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
