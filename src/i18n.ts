import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  const messages = (await import('./messages/he.json')).default;

  return {
    locale: 'he',
    messages: messages as any,
  };
});
