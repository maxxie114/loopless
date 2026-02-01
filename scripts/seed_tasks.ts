/**
 * Seed tasks into Redis or external store if needed.
 * Currently tasks are defined in server/src/tasks.ts; this script can be extended
 * to sync to a database or validate task definitions.
 */
// Tasks are defined in apps/server/src/tasks.ts
// This script can import from server when run with tsx from repo root:
// pnpm exec tsx scripts/seed_tasks.ts
async function listTasks() {
  const mod = await import("../apps/server/src/tasks.js");
  return mod.listTasks();
}

function main() {
  const tasks = listTasks();
  console.log("Tasks:", tasks.length);
  for (const t of tasks) {
    console.log("  -", t.id, t.name);
  }
}

main().catch(console.error);
