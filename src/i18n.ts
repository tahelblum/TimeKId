import { getRequestConfig } from 'next-intl/server';
import { AbstractIntlMessages } from 'next-intl';

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) ?? 'he';
  
  const messages = (await import(`./messages/${locale}.json`)).default as AbstractIntlMessages;

  return {
    locale,
    messages,
  };
});
