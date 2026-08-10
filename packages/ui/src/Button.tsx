import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'danger' | 'icon';
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'default', className, type = 'button', ...props }, ref) {
  return <button ref={ref} type={type} className={['ui-button', `ui-button--${variant}`, className].filter(Boolean).join(' ')} {...props} />;
});
