import { getRequestConfig } from 'next-intl/server';
import { headers } from 'next/headers';

export default getRequestConfig(async () => {
  let locale = 'he'; // ברירת מחדל

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
    messages: (await import(`./messages/${locale}.json`)).default
  };
});
