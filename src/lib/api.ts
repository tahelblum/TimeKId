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
    UPDATE_TASK: (childId: number, taskId: number) => `/children/${childId}/tasks/${taskId}`,
    SECONDARY_PARENT: (id: number) => `/children/${id}/secondary-parent`,
    COMPLIMENT: (id: number) => `/children/${id}/compliment`,
    REMINDER: (id: number) => `/children/${id}/reminder`,
  },
  CHILD: {
    MY_TASKS: '/child/tasks',
    UPDATE_TASK: (id: number) => `/child/tasks/${id}`,
  },
  TASKS: {
    BOT: '/tasks/bot',
    FROM_DOCUMENT: '/tasks/from-document',
  },
};
