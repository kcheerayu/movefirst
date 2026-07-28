export type TaskState = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";

export function isOverdue(task: { status: TaskState; due_date: string | null }, today = new Date()) {
  if (!task.due_date || task.status === "DONE") return false;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return new Date(`${task.due_date}T00:00:00`) < startOfToday;
}

export function isDueThisWeek(task: { status: TaskState; due_date: string | null }, today = new Date()) {
  if (!task.due_date || task.status === "DONE") return false;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const due = new Date(`${task.due_date}T00:00:00`);
  return due >= start && due < end;
}

export function projectProgress(tasks: { status: TaskState }[]) {
  if (!tasks.length) return { complete: 0, total: 0, percent: 0 };
  const complete = tasks.filter((task) => task.status === "DONE").length;
  return { complete, total: tasks.length, percent: Math.round((complete / tasks.length) * 100) };
}
