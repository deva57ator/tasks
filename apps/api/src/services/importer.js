const projectsService = require('./projects');
const tasksService = require('./tasks');
const archiveService = require('./archive');
const workdaysService = require('./workdays');
const { nowIso } = require('../lib/time');

function normalizeTasks(list, parentId = null, acc = []) {
  if (!Array.isArray(list)) return acc;
  for (const item of list) {
    if (!item || !item.id) continue;
    const createdAt = item.createdAt || nowIso();
    const updatedAt = item.updatedAt || createdAt;
    acc.push({
      id: item.id,
      title: item.title || '',
      done: item.done === true,
      due: item.due || null,
      project: item.project || null,
      notes: item.notes || '',
      timeSpent: Number.isFinite(Number(item.timeSpent)) ? Math.max(0, Number(item.timeSpent)) : 0,
      parentId,
      createdAt,
      updatedAt,
      completedAt: item.completedAt || null
    });
    if (Array.isArray(item.children) && item.children.length) {
      normalizeTasks(item.children, item.id, acc);
    }
  }
  return acc;
}

function normalizeArchive(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || !item.id) return null;
      return {
        id: item.id,
        payload: item,
        archivedAt: item.archivedAt || nowIso()
      };
    })
    .filter(Boolean);
}

async function importData(payload) {
  const tasksKey = 'mini-task-tracker:text:min:v14';
  const projectsKey = 'mini-task-tracker:projects';
  const workdayKey = 'mini-task-tracker:workday';
  const archiveKey = 'mini-task-tracker:archive:v1';

  const tasks = payload[tasksKey] || payload.tasks || [];
  const projects = payload[projectsKey] || payload.projects || [];
  const workday = payload[workdayKey] || payload.workday || null;
  const archive = payload[archiveKey] || payload.archive || [];

  await projectsService.importMany(Array.isArray(projects) ? projects : []);
  await tasksService.importMany(normalizeTasks(tasks));
  await archiveService.importMany(normalizeArchive(archive));
  if (workday && workday.id) {
    await workdaysService.importCurrent({
      id: workday.id,
      startTs: workday.start || null,
      endTs: workday.end || null,
      summaryTimeMs: workday.finalTimeMs || 0,
      summaryDone: workday.finalDoneCount || 0,
      payload: workday,
      closedAt: workday.closedAt || null,
      createdAt: workday.createdAt || nowIso(),
      updatedAt: workday.updatedAt || nowIso()
    });
  }
}

module.exports = {
  importData
};
