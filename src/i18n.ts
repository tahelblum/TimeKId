import { getRequestConfig } from 'next-intl/server';
import { headers } from 'next/headers';
import heMessages from './messages/he.json';
import enMessages from './messages/en.json';

const messagesMap: Record<string, object> = {
  he: heMessages,
  en: enMessages,
};

export default getRequestConfig(async () => {
  let locale = 'he';

  try {
    const headersList = await headers();
    const acceptLanguage = headersList.get('accept-language') || '';
    if (acceptLanguage.toLowerCase().includes('en') && !acceptLanguage.toLowerCase().includes('he')) {
      locale = 'en';
    }
  } catch {
    locale = 'he';
  }

  return {
    locale,
    messages: messagesMap[locale],
  };
});
