export const API_URL = 'https://x8ki-letl-twmt.n7.xano.io/api:UgeJ6dlR';

export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    SIGNUP: '/auth/signup',
    ME: '/auth/me',
  },
  CHILD_AUTH: {
    LOGIN: '/auth/child-login',
    ME: '/auth/child-me',
  },
  CHILDREN: {
    LIST: '/children',
    CREATE: '/children',
    GET: (id: number) => `/children/${id}`,
    TASKS: (id: number) => `/children/${id}/tasks`,
    CREATE_TASK: (id: number) => `/children/${id}/tasks`,
    UPDATE_TASK: (childId: number, taskId: number) => `/children/${childId}/tasks/${taskId}`,
    SCHEDULE: (id: number) => `/children/${id}/schedule`,
    EXAMS: (id: number) => `/children/${id}/exams`,
    SECONDARY_PARENT: (id: number) => `/children/${id}/secondary-parent`,
    COMPLIMENT: (id: number) => `/children/${id}/compliment`,
    REMINDER: (id: number) => `/children/${id}/reminder`,
  },
  CHILD: {
    MY_TASKS: '/child/tasks',
    CREATE_TASK: '/child/tasks',
    UPDATE_TASK: (id: number) => `/child/tasks/${id}`,
    SCHEDULE: '/child/schedule',
    DELETE_SCHEDULE: (id: number) => `/child/schedule/${id}`,
    EXAMS: '/child/exams',
    CREATE_EXAM: '/child/exams',
    UPDATE_EXAM: (id: number) => `/child/exams/${id}`,
    HOLIDAYS: '/child/holidays',
    SUBJECTS: '/child/subjects',
  },
  TASKS: {
    BOT: '/tasks/bot',
    FROM_DOCUMENT: '/tasks/from-document',
  },
};
