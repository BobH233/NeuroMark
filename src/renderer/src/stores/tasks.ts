import { defineStore } from 'pinia';
import type { BackgroundJob } from '@preload/contracts';

export const useTasksStore = defineStore('tasks', {
  state: () => ({
    tasks: [] as BackgroundJob[],
    unbind: null as null | (() => void),
  }),
  actions: {
    async bootstrap() {
      this.tasks = await window.neuromark.tasks.list();
      if (!this.unbind) {
        this.unbind = window.neuromark.tasks.onUpdated((tasks) => {
          this.tasks = tasks;
        });
      }
    },
  },
});

