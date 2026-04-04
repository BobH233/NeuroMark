import { defineStore } from 'pinia';
import type {
  CreateProjectValidationResult,
  CreateProjectInput,
  ExportResultsOptions,
  FinalResult,
  ProjectDetail,
  ProjectMeta,
  ProjectRubricDebug,
  ProjectSettings,
  ResultRecord,
  SaveFinalResultOptions,
} from '@preload/contracts';

export const useProjectsStore = defineStore('projects', {
  state: () => ({
    projects: [] as ProjectMeta[],
    selectedProjectId: '' as string,
    detail: null as ProjectDetail | null,
    rubricDebug: null as ProjectRubricDebug | null,
    loading: false,
  }),
  getters: {
    selectedProject(state) {
      return state.projects.find((item) => item.id === state.selectedProjectId) ?? null;
    },
  },
  actions: {
    async bootstrap() {
      await this.loadProjects();
    },
    async loadProjects() {
      this.projects = await window.neuromark.projects.list();
      if (!this.projects.some((item) => item.id === this.selectedProjectId)) {
        this.selectedProjectId = '';
        this.detail = null;
      }
    },
    clearSelection() {
      this.selectedProjectId = '';
      this.detail = null;
      this.rubricDebug = null;
    },
    async selectProject(projectId: string) {
      this.selectedProjectId = projectId;
      await this.loadProjectDetail(projectId);
    },
    async loadProjectDetail(projectId: string) {
      this.loading = true;
      try {
        this.detail = await window.neuromark.projects.getDetail(projectId);
      } finally {
        this.loading = false;
      }
    },
    async loadProjectRubricDebug(projectId: string) {
      this.rubricDebug = await window.neuromark.projects.getRubricDebug(projectId);
      return this.rubricDebug;
    },
    async createProject(input: CreateProjectInput) {
      const project = await window.neuromark.projects.create(input);
      await this.loadProjects();
      await this.selectProject(project.id);
      return project;
    },
    async validateCreateProject(
      input: Pick<CreateProjectInput, 'name' | 'basePath'>,
    ): Promise<CreateProjectValidationResult> {
      return window.neuromark.projects.validateCreate(input);
    },
    async deleteProject(projectId: string) {
      await window.neuromark.projects.delete(projectId);
      await this.loadProjects();
      if (this.selectedProjectId === projectId) {
        this.clearSelection();
      }
    },
    async updateProjectName(projectId: string, name: string) {
      await window.neuromark.projects.updateName(projectId, name);
      await this.loadProjects();
      await this.loadProjectDetail(projectId);
    },
    async removePaper(projectId: string, paperId: string) {
      this.detail = await window.neuromark.projects.removePaper(projectId, paperId);
      await this.loadProjects();
      return this.detail;
    },
    async importOriginalImages(projectId: string, filePaths: string[]) {
      await window.neuromark.projects.importOriginalImages(projectId, filePaths);
      await this.loadProjects();
      await this.loadProjectDetail(projectId);
    },
    async updateProjectSettings(projectId: string, settings: ProjectSettings) {
      await window.neuromark.projects.updateSettings(projectId, {
        gradingConcurrency: settings.gradingConcurrency,
        drawRegions: settings.drawRegions,
        defaultImageDetail: settings.defaultImageDetail,
        enableScanPostProcess: settings.enableScanPostProcess,
      });
      await this.loadProjects();
      await this.loadProjectDetail(projectId);
    },
    async updateReferenceAnswer(projectId: string, markdown: string) {
      await window.neuromark.projects.updateReferenceAnswer(projectId, markdown);
      await this.loadProjects();
      await this.loadProjectDetail(projectId);
    },
    async saveFinalResult(
      projectId: string,
      paperId: string,
      finalResult: FinalResult,
      options?: SaveFinalResultOptions,
    ) {
      const updated = await window.neuromark.results.saveFinal(
        projectId,
        paperId,
        finalResult,
        options,
      );
      await this.loadProjects();
      await this.loadProjectDetail(projectId);
      return updated;
    },
    async deleteResult(projectId: string, paperId: string) {
      await window.neuromark.results.delete(projectId, paperId);
      await this.loadProjects();
      await this.loadProjectDetail(projectId);
    },
    async exportResults(projectId: string, options?: ExportResultsOptions) {
      return window.neuromark.results.exportJson(projectId, options);
    },
    getResultByPaperId(paperId: string): ResultRecord | null {
      return this.detail?.results.find((item) => item.paperId === paperId) ?? null;
    },
  },
});
