const db = require('../db/client');

function sumTime(task) {
  let total = Number(task.timeSpent || 0);
  if (Array.isArray(task.children)) {
    for (const child of task.children) {
      total += sumTime(child);
    }
  }
  return total;
}

function countTasks(task) {
  let total = 1;
  if (Array.isArray(task.children)) {
    for (const child of task.children) {
      total += countTasks(child);
    }
  }
  return total;
}

async function summary() {
  const activeTotals = await db.get('SELECT COUNT(1) AS total, SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) AS completed, SUM(timeSpentMs) AS timeSpent FROM tasks');
  const archiveRows = await db.all('SELECT payload FROM archive');
  let archivedTasks = 0;
  let archivedTime = 0;
  for (const row of archiveRows) {
    try {
      const payload = JSON.parse(row.payload);
      archivedTime += sumTime(payload);
      archivedTasks += countTasks(payload);
    } catch (e) {
      // ignore invalid payload
    }
  }
  return {
    activeTasks: Number(activeTotals?.total || 0),
    activeCompleted: Number(activeTotals?.completed || 0),
    activeTimeSpentMs: Number(activeTotals?.timeSpent || 0),
    archivedTasks,
    archivedTimeSpentMs: archivedTime
  };
}

module.exports = {
  summary
};
