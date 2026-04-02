import { contextBridge, ipcRenderer } from 'electron';
import type {
  AnswerGeneratorUpdateHandler,
  DebugLogHandler,
  NeuromarkApi,
  TaskUpdateHandler,
} from './contracts';

const api: NeuromarkApi = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getDefaultProjectBasePath: () => ipcRenderer.invoke('app:get-default-project-base-path'),
    selectDirectory: () => ipcRenderer.invoke('app:select-directory'),
    selectImages: () => ipcRenderer.invoke('app:select-images'),
    openPath: (targetPath) => ipcRenderer.invoke('app:open-path', targetPath),
    openDevTools: () => ipcRenderer.invoke('app:open-devtools'),
    enableDebugPanel: () => ipcRenderer.invoke('app:enable-debug-panel'),
    getPreviewSession: (token) => ipcRenderer.invoke('app:get-preview-session', token),
    getDebugLogs: () => ipcRenderer.invoke('app:get-debug-logs'),
    onDebugLog: (handler: DebugLogHandler) => {
      const listener = (_event: Electron.IpcRendererEvent, entry: unknown) => {
        handler(entry as any);
      };
      ipcRenderer.on('app:debug-log', listener);
      return () => {
        ipcRenderer.removeListener('app:debug-log', listener);
      };
    },
  },
  projects: {
    create: (input) => ipcRenderer.invoke('projects:create', input),
    validateCreate: (input) => ipcRenderer.invoke('projects:validate-create', input),
    list: () => ipcRenderer.invoke('projects:list'),
    getDetail: (projectId) => ipcRenderer.invoke('projects:get-detail', projectId),
    getRubricDebug: (projectId) => ipcRenderer.invoke('projects:get-rubric-debug', projectId),
    delete: (projectId) => ipcRenderer.invoke('projects:delete', projectId),
    updateName: (projectId, name) => ipcRenderer.invoke('projects:update-name', projectId, name),
    removePaper: (projectId, paperId) => ipcRenderer.invoke('projects:remove-paper', projectId, paperId),
    importOriginalImages: (projectId, filePaths) =>
      ipcRenderer.invoke('projects:import-original-images', projectId, filePaths),
    updateSettings: (projectId, settings) =>
      ipcRenderer.invoke('projects:update-settings', projectId, settings),
    updateReferenceAnswer: (projectId, markdown) =>
      ipcRenderer.invoke('projects:update-reference-answer', projectId, markdown),
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
    saveFinal: (projectId, paperId, finalResult, options) =>
      ipcRenderer.invoke('results:save-final', projectId, paperId, finalResult, options),
    delete: (projectId, paperId) => ipcRenderer.invoke('results:delete', projectId, paperId),
    exportJson: (projectId, targetPath) =>
      ipcRenderer.invoke('results:export-json', projectId, targetPath),
    getSmartNameMatchSnapshot: (projectId) =>
      ipcRenderer.invoke('results:get-smart-name-match-snapshot', projectId),
    startSmartNameMatch: (projectId, rosterText) =>
      ipcRenderer.invoke('results:start-smart-name-match', projectId, rosterText),
    applySmartNameMatch: (projectId) =>
      ipcRenderer.invoke('results:apply-smart-name-match', projectId),
    onSmartNameMatchUpdated: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: unknown) => {
        handler(snapshot as any);
      };
      ipcRenderer.on('results:smart-name-match-updated', listener);
      return () => {
        ipcRenderer.removeListener('results:smart-name-match-updated', listener);
      };
    },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (input) => ipcRenderer.invoke('settings:save', input),
    testLlmConnection: (payload) => ipcRenderer.invoke('settings:test', payload),
  },
  answerGenerator: {
    getState: () => ipcRenderer.invoke('answer-generator:get-state'),
    listDrafts: () => ipcRenderer.invoke('answer-generator:list-drafts'),
    listPromptPresets: () => ipcRenderer.invoke('answer-generator:list-presets'),
    savePromptPreset: (input) => ipcRenderer.invoke('answer-generator:save-preset', input),
    deletePromptPreset: (presetId) => ipcRenderer.invoke('answer-generator:delete-preset', presetId),
    createDraft: (input) => ipcRenderer.invoke('answer-generator:create-draft', input),
    startGeneration: (draftId) => ipcRenderer.invoke('answer-generator:start-generation', draftId),
    updateDraft: (draftId, markdown) =>
      ipcRenderer.invoke('answer-generator:update-draft', draftId, markdown),
    deleteDraft: (draftId) => ipcRenderer.invoke('answer-generator:delete-draft', draftId),
    onUpdated: (handler: AnswerGeneratorUpdateHandler) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: unknown) => {
        handler(snapshot as any);
      };
      ipcRenderer.on('answer-generator:updated', listener);
      return () => {
        ipcRenderer.removeListener('answer-generator:updated', listener);
      };
    },
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    listArchived: () => ipcRenderer.invoke('tasks:list-archived'),
    archiveVisible: () => ipcRenderer.invoke('tasks:archive-visible'),
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
    open: (images, initialIndex, title, activeQuestionId, displayOptions) =>
      ipcRenderer.invoke(
        'preview:open',
        images,
        initialIndex,
        title,
        activeQuestionId,
        displayOptions,
      ),
    setActiveQuestion: (token, activeQuestionId) =>
      ipcRenderer.invoke('preview:set-active-question', token, activeQuestionId),
    setDisplayOptions: (token, displayOptions) =>
      ipcRenderer.invoke('preview:set-display-options', token, displayOptions),
    onActiveQuestionChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        handler(payload as any);
      };
      ipcRenderer.on('preview:active-question-changed', listener);
      return () => {
        ipcRenderer.removeListener('preview:active-question-changed', listener);
      };
    },
    onDisplayOptionsChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        handler(payload as any);
      };
      ipcRenderer.on('preview:display-options-changed', listener);
      return () => {
        ipcRenderer.removeListener('preview:display-options-changed', listener);
      };
    },
    copyImage: (source) => ipcRenderer.invoke('preview:copy-image', source),
    saveImage: (source, suggestedName) =>
      ipcRenderer.invoke('preview:save-image', source, suggestedName),
  },
};

contextBridge.exposeInMainWorld('neuromark', api);
