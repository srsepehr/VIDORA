'use client';

import React, { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

type MotionButtonVariant = 'primary' | 'secondary';

export interface MotionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: ReactNode;
  variant?: MotionButtonVariant;
  classes?: string;
  rtl?: boolean;
  animate?: boolean;
  delay?: number;
}

const MotionButton = forwardRef<HTMLButtonElement, MotionButtonProps>(function MotionButton(
  {
    label,
    variant = 'primary',
    classes,
    className,
    rtl = false,
    animate = true,
    delay = 0,
    type = 'button',
    disabled,
    style,
    ...props
  },
  ref,
) {
  const ArrowIcon = rtl ? ArrowLeft : ArrowRight;
  const isPrimary = variant === 'primary';

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        'group relative isolate inline-flex h-14 min-w-[13rem] cursor-pointer items-center overflow-hidden rounded-full border p-1 font-geist outline-none transition-[opacity,box-shadow] duration-200',
        'focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
        isPrimary
          ? 'border-zinc-300 bg-white text-zinc-950 shadow-sm'
          : 'border-zinc-700 bg-zinc-950 text-white',
        classes,
        className,
      )}
      style={{ transitionDelay: delay ? `${delay}ms` : undefined, ...style }}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-0 z-0 block rounded-[inherit] transition-transform duration-[400ms] ease-out motion-reduce:transition-none',
          rtl ? 'origin-right' : 'origin-left',
          isPrimary ? 'bg-zinc-950' : 'bg-white',
          animate
            ? 'scale-x-0 group-hover:scale-x-100 group-focus-visible:scale-x-100'
            : 'scale-x-100',
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'absolute start-1 top-1/2 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full',
          isPrimary ? 'bg-zinc-950 text-white' : 'bg-white text-zinc-950',
        )}
      >
        <ArrowIcon className="size-5" strokeWidth={1.8} />
      </span>
      <span
        className={cn(
          'relative z-10 mx-auto px-12 text-center text-sm font-bold tracking-normal whitespace-nowrap transition-colors duration-[400ms] ease-out motion-reduce:transition-none',
          isPrimary
            ? 'text-zinc-950 group-hover:text-white group-focus-visible:text-white'
            : 'text-white group-hover:text-zinc-950 group-focus-visible:text-zinc-950',
          !animate && (isPrimary ? 'text-white' : 'text-zinc-950'),
        )}
      >
        {label}
      </span>
    </button>
  );
});

export default MotionButton;
