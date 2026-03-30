import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/projects',
    },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('@/views/ProjectsView.vue'),
      children: [
        {
          path: '',
          name: 'projects-home',
          component: () => import('@/views/ProjectsHomeView.vue'),
        },
        {
          path: ':projectId',
          name: 'project-detail',
          component: () => import('@/views/ProjectDetailView.vue'),
        },
      ],
    },
    {
      path: '/tasks',
      name: 'tasks',
      component: () => import('@/views/TasksView.vue'),
    },
    {
      path: '/answer-generator',
      name: 'answer-generator',
      component: () => import('@/views/AnswerGeneratorView.vue'),
      children: [
        {
          path: '',
          name: 'answer-generator-home',
          component: () => import('@/views/AnswerGeneratorHomeView.vue'),
        },
        {
          path: 'new',
          name: 'answer-generator-new',
          component: () => import('@/views/AnswerGeneratorNewView.vue'),
        },
        {
          path: ':draftId',
          name: 'answer-generator-detail',
          component: () => import('@/views/AnswerGeneratorDetailView.vue'),
        },
      ],
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
    },
    {
      path: '/preview/:token',
      name: 'preview',
      component: () => import('@/views/PreviewView.vue'),
    },
  ],
});

export default router;
