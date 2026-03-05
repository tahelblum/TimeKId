import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  const locale = 'he';
  const messages = (await import('./messages/he.json')).default;

  return {
    locale,
    messages: messages as any,
  };
});
