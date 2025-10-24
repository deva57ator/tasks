function mapRowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    done: row.done === 1,
    due: row.due || null,
    project: row.projectId || null,
    notes: row.notes || '',
    timeSpent: Number(row.timeSpentMs || 0),
    parentId: row.parentId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt || null,
    children: [],
    collapsed: false,
    timerActive: false,
    timerStart: null
  };
}

function buildTaskTree(rows) {
  const map = new Map();
  const roots = [];
  for (const row of rows) {
    const task = mapRowToTask(row);
    map.set(task.id, task);
  }
  for (const task of map.values()) {
    if (task.parentId && map.has(task.parentId)) {
      const parent = map.get(task.parentId);
      parent.children.push(task);
    } else {
      roots.push(task);
    }
  }
  const sortChildren = (list) => {
    list.sort((a, b) => {
      if (a.createdAt === b.createdAt) {
        return a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' });
      }
      return a.createdAt < b.createdAt ? -1 : 1;
    });
    for (const item of list) {
      if (item.children && item.children.length) {
        sortChildren(item.children);
      }
    }
  };
  sortChildren(roots);
  return { roots, map };
}

function filterTasksTree(tasks, filters) {
  const { projectId, done, dueFrom, dueTo } = filters;
  const fromTs = dueFrom ? Date.parse(dueFrom) : null;
  const toTs = dueTo ? Date.parse(dueTo) : null;

  function matches(task) {
    if (projectId && task.project !== projectId) return false;
    if (typeof done === 'boolean' && task.done !== done) return false;
    if (fromTs !== null || toTs !== null) {
      if (!task.due) return false;
      const dueTs = Date.parse(task.due);
      if (Number.isNaN(dueTs)) return false;
      if (fromTs !== null && dueTs < fromTs) return false;
      if (toTs !== null && dueTs > toTs) return false;
    }
    return true;
  }

  function visit(list) {
    const out = [];
    for (const task of list) {
      const filteredChildren = visit(task.children || []);
      const selfMatches = matches(task);
      if (selfMatches || filteredChildren.length) {
        out.push({
          ...task,
          children: filteredChildren
        });
      }
    }
    return out;
  }

  return visit(tasks);
}

function flattenTasks(list) {
  const out = [];
  function walk(tasks) {
    for (const task of tasks) {
      out.push(task);
      if (task.children && task.children.length) {
        walk(task.children);
      }
    }
  }
  walk(list);
  return out;
}

function collectDescendantIds(task) {
  const ids = [task.id];
  if (task.children) {
    for (const child of task.children) {
      ids.push(...collectDescendantIds(child));
    }
  }
  return ids;
}

function filterTasksByIds(list, idSet) {
  const out = [];
  for (const task of list) {
    const filteredChildren = filterTasksByIds(task.children || [], idSet);
    if (idSet.has(task.id) || filteredChildren.length) {
      out.push({
        ...task,
        children: filteredChildren
      });
    }
  }
  return out;
}

module.exports = {
  mapRowToTask,
  buildTaskTree,
  filterTasksTree,
  flattenTasks,
  collectDescendantIds,
  filterTasksByIds
};
