import { Menu } from '@base-ui/react/menu';
import type { ThemePreference } from '../theme';
import { useI18n, type TranslationKey } from '@prompt-prism/plugins/dashboard';

const options: Array<{ value: ThemePreference; label: TranslationKey; icon: 'system' | 'light' | 'dark' }> = [
  { value: 'system', label: 'theme.system', icon: 'system' },
  { value: 'light', label: 'theme.light', icon: 'light' },
  { value: 'dark', label: 'theme.dark', icon: 'dark' },
];

function ThemeIcon({ type }: { type: 'system' | 'light' | 'dark' }) {
  if (type === 'system') {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="11" /><path d="M7 17h6M10 14v3" /></svg>;
  }
  if (type === 'light') {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.25" /><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M16 4l-1.4 1.4M5.4 14.6 4 16" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.8 12.4A7 7 0 0 1 7.6 3.2a7 7 0 1 0 9.2 9.2Z" /></svg>;
}

export function ThemeMenu({ preference, onPreferenceChange }: {
  preference: ThemePreference;
  onPreferenceChange: (preference: ThemePreference) => void;
}) {
  const { t } = useI18n();
  const selected = options.find((option) => option.value === preference)!;

  return (
    <Menu.Root>
      <Menu.Trigger className="theme-trigger" aria-label={`${t('theme.label')}: ${t(selected.label)}`} title={`${t('theme.label')}: ${t(selected.label)}`}>
        <ThemeIcon type={selected.icon} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={7} align="end" className="theme-positioner">
          <Menu.Popup className="theme-popup" aria-label={t('theme.label')}>
            <div className="theme-menu-label">{t('theme.label')}</div>
            <Menu.RadioGroup value={preference} onValueChange={(value) => onPreferenceChange(value as ThemePreference)}>
              {options.map((option) => (
                <Menu.RadioItem key={option.value} value={option.value} className="theme-option">
                  <ThemeIcon type={option.icon} />
                  <span>{t(option.label)}</span>
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
