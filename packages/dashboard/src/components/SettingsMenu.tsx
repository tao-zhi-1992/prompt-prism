import { Menu } from '@base-ui/react/menu';
import { useI18n, type Locale, type TranslationKey } from '@prompt-prism/plugins/dashboard';
import type { ThemePreference } from '../theme';

const themes: Array<{ value: ThemePreference; label: TranslationKey; icon: 'system' | 'light' | 'dark' }> = [
  { value: 'system', label: 'theme.system', icon: 'system' },
  { value: 'light', label: 'theme.light', icon: 'light' },
  { value: 'dark', label: 'theme.dark', icon: 'dark' },
];

const languages: Array<{ value: Locale; label: TranslationKey; symbol: string }> = [
  { value: 'en', label: 'language.english', symbol: 'EN' },
  { value: 'zh-CN', label: 'language.chinese', symbol: '中' },
];

function ThemeIcon({ type }: { type: 'system' | 'light' | 'dark' }) {
  if (type === 'system') return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="11" /><path d="M7 17h6M10 14v3" /></svg>;
  if (type === 'light') return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.25" /><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M16 4l-1.4 1.4M5.4 14.6 4 16" /></svg>;
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.8 12.4A7 7 0 0 1 7.6 3.2a7 7 0 1 0 9.2 9.2Z" /></svg>;
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7.8 2.25h4.4l.45 2.05c.55.2 1.05.5 1.5.87l2-.65 2.2 3.83-1.55 1.4a6 6 0 0 1 0 1.75l1.55 1.4-2.2 3.83-2-.65c-.45.37-.95.67-1.5.87L12.2 19h-4.4l-.45-2.05a6.8 6.8 0 0 1-1.5-.87l-2 .65-2.2-3.83 1.55-1.4a6 6 0 0 1 0-1.75l-1.55-1.4 2.2-3.83 2 .65c.45-.37.95-.67 1.5-.87z" />
      <circle cx="10" cy="10.625" r="2.5" />
    </svg>
  );
}

export function SettingsMenu({ preference, onPreferenceChange, locale, onLocaleChange }: {
  preference: ThemePreference;
  onPreferenceChange: (preference: ThemePreference) => void;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  const { t } = useI18n();
  return (
    <Menu.Root>
      <Menu.Trigger className="settings-trigger" aria-label={t('settings.label')} title={t('settings.label')}>
        <SettingsIcon />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={7} align="end" className="settings-positioner">
          <Menu.Popup className="settings-popup" aria-label={t('settings.label')}>
            <div className="settings-menu-label">{t('theme.label')}</div>
            <Menu.RadioGroup value={preference} onValueChange={(value) => onPreferenceChange(value as ThemePreference)}>
              {themes.map((option) => (
                <Menu.RadioItem key={option.value} value={option.value} className="settings-option">
                  <ThemeIcon type={option.icon} />
                  <span>{t(option.label)}</span>
                  <Menu.RadioItemIndicator className="settings-option-indicator">✓</Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Separator className="settings-separator" />
            <div className="settings-menu-label">{t('language.label')}</div>
            <Menu.RadioGroup value={locale} onValueChange={(value) => onLocaleChange(value as Locale)}>
              {languages.map((option) => (
                <Menu.RadioItem key={option.value} value={option.value} className="settings-option">
                  <span className="settings-language-symbol">{option.symbol}</span>
                  <span>{t(option.label)}</span>
                  <Menu.RadioItemIndicator className="settings-option-indicator">✓</Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
