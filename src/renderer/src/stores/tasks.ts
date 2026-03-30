import { defineStore } from 'pinia';
import type { BackgroundJob } from '@preload/contracts';

export const useTasksStore = defineStore('tasks', {
  state: () => ({
    tasks: [] as BackgroundJob[],
    archivedTasks: [] as BackgroundJob[],
    unbind: null as null | (() => void),
  }),
  actions: {
    async bootstrap() {
      await this.refresh();
      if (!this.unbind) {
        this.unbind = window.neuromark.tasks.onUpdated(() => {
          void this.refresh();
        });
      }
    },
    async refresh() {
      const [tasks, archivedTasks] = await Promise.all([
        window.neuromark.tasks.list(),
        window.neuromark.tasks.listArchived(),
      ]);
      this.tasks = tasks;
      this.archivedTasks = archivedTasks;
    },
    async archiveVisible() {
      await window.neuromark.tasks.archiveVisible();
      await this.refresh();
    },
  },
});
