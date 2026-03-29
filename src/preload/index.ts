import { contextBridge, ipcRenderer } from 'electron';
import type { NeuromarkApi, TaskUpdateHandler } from './contracts';

const api: NeuromarkApi = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    selectDirectory: () => ipcRenderer.invoke('app:select-directory'),
    selectImages: () => ipcRenderer.invoke('app:select-images'),
    openPath: (targetPath) => ipcRenderer.invoke('app:open-path', targetPath),
    getPreviewSession: (token) => ipcRenderer.invoke('app:get-preview-session', token),
  },
  projects: {
    create: (input) => ipcRenderer.invoke('projects:create', input),
    list: () => ipcRenderer.invoke('projects:list'),
    getDetail: (projectId) => ipcRenderer.invoke('projects:get-detail', projectId),
    importOriginalImages: (projectId, filePaths) =>
      ipcRenderer.invoke('projects:import-original-images', projectId, filePaths),
    updateSettings: (projectId, settings) =>
      ipcRenderer.invoke('projects:update-settings', projectId, settings),
  },
  scan: {
    start: (projectId, options) => ipcRenderer.invoke('scan:start', projectId, options),
    cancel: (jobId) => ipcRenderer.invoke('scan:cancel', jobId),
    list: (projectId) => ipcRenderer.invoke('scan:list', projectId),
  },
  grading: {
    start: (projectId, options) => ipcRenderer.invoke('grading:start', projectId, options),
    cancel: (jobId) => ipcRenderer.invoke('grading:cancel', jobId),
    resume: (projectId) => ipcRenderer.invoke('grading:resume', projectId),
  },
  results: {
    list: (projectId) => ipcRenderer.invoke('results:list', projectId),
    get: (projectId, paperId) => ipcRenderer.invoke('results:get', projectId, paperId),
    saveFinal: (projectId, paperId, finalResult) =>
      ipcRenderer.invoke('results:save-final', projectId, paperId, finalResult),
    exportJson: (projectId, targetPath) =>
      ipcRenderer.invoke('results:export-json', projectId, targetPath),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (input) => ipcRenderer.invoke('settings:save', input),
    testLlmConnection: (payload) => ipcRenderer.invoke('settings:test', payload),
  },
  answerGenerator: {
    listDrafts: () => ipcRenderer.invoke('answer-generator:list-drafts'),
    listPromptPresets: () => ipcRenderer.invoke('answer-generator:list-presets'),
    createDraft: (input) => ipcRenderer.invoke('answer-generator:create-draft', input),
    updateDraft: (draftId, markdown) =>
      ipcRenderer.invoke('answer-generator:update-draft', draftId, markdown),
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    onUpdated: (handler: TaskUpdateHandler) => {
      const listener = (_event: Electron.IpcRendererEvent, tasks: unknown) => {
        handler(tasks as any);
      };
      ipcRenderer.on('tasks:updated', listener);
      return () => {
        ipcRenderer.removeListener('tasks:updated', listener);
      };
    },
  },
  preview: {
    open: (images, initialIndex, title) =>
      ipcRenderer.invoke('preview:open', images, initialIndex, title),
  },
};

contextBridge.exposeInMainWorld('neuromark', api);

