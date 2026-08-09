import { Menu } from '@base-ui/react/menu';
import { useI18n, type Locale } from '@prompt-prism/plugins/dashboard';

const options: Locale[] = ['en', 'zh-CN'];

export function LanguageMenu({ locale, onLocaleChange }: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  const { t } = useI18n();
  const label = locale === 'zh-CN' ? t('language.chinese') : t('language.english');
  return (
    <Menu.Root>
      <Menu.Trigger className="theme-trigger language-trigger" aria-label={`${t('language.label')}: ${label}`} title={`${t('language.label')}: ${label}`}>
        <span aria-hidden="true">文</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={7} align="end" className="theme-positioner">
          <Menu.Popup className="theme-popup" aria-label={t('language.label')}>
            <div className="theme-menu-label">{t('language.label')}</div>
            <Menu.RadioGroup value={locale} onValueChange={(value) => onLocaleChange(value as Locale)}>
              {options.map((value) => (
                <Menu.RadioItem key={value} value={value} className="theme-option">
                  <span>{value === 'en' ? 'EN' : '中'}</span>
                  <span>{value === 'en' ? t('language.english') : t('language.chinese')}</span>
                  <Menu.RadioItemIndicator className="theme-option-indicator">✓</Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
