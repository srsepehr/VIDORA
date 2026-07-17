'use client';

import React from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Globe2, Headphones, ShieldCheck } from 'lucide-react';

export interface VidoraFooterProps {
  locale?: 'fa' | 'en';
}

const footerCopy = {
  fa: {
    benefits: [
      [Globe2, 'یادگیری جهانی', 'بهترین محتوای آموزشی دنیا را به زبان فارسی در اختیار شما قرار می‌دهیم.'],
      [ShieldCheck, 'امن و قابل اعتماد', 'حریم خصوصی شما برای ما اهمیت دارد و اطلاعاتتان امن و محفوظ است.'],
      [Headphones, 'پشتیبانی همیشه در دسترس', 'هر سؤالی دارید، تیم ما آماده کمک و راهنمایی شماست.'],
    ] as const,
    links: ['قوانین و مقررات', 'درباره ما', 'تماس با ما'],
  },
  en: {
    benefits: [
      [Globe2, 'Global learning', "The world's best educational content, made understandable in Persian."],
      [ShieldCheck, 'Safe and reliable', 'Your privacy matters, and your information remains protected.'],
      [Headphones, 'Support within reach', 'Our team is ready to help whenever you have a question.'],
    ] as const,
    links: ['Terms', 'About', 'Contact'],
  },
};

export function VidoraFooter({ locale = 'fa' }: VidoraFooterProps) {
  const copy = footerCopy[locale];
  const rtl = locale === 'fa';

  return (
    <footer dir={rtl ? 'rtl' : 'ltr'} className="w-full bg-zinc-950 text-white">
      <div className="mx-auto w-full max-w-[1280px] px-6 md:px-10 lg:px-12">
        <div className="grid gap-0 border-b border-white/10 py-7 md:grid-cols-3 md:py-8">
          {copy.benefits.map(([Icon, title, body], index) => (
            <AnimatedContainer
              key={title}
              delay={0.08 + index * 0.08}
              className="flex items-start gap-3 border-white/10 py-4 first:pt-0 last:pb-0 max-md:[&+&]:border-t md:px-8 md:py-1 md:first:ps-0 md:last:pe-0 md:[&+&]:border-s"
            >
              <Icon className="mt-0.5 size-6 shrink-0" strokeWidth={1.45} />
              <div>
                <h3 className="m-0 text-sm font-bold text-white">{title}</h3>
                <p className="mt-1.5 max-w-72 text-xs leading-6 text-zinc-400">{body}</p>
              </div>
            </AnimatedContainer>
          ))}
        </div>

        <div className="flex justify-center py-6 md:py-7">
          <AnimatedContainer delay={0.16} className="w-full">
            <div aria-label={rtl ? 'اطلاعات پایانی' : 'Footer information'}>
              <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-x-6 gap-y-3 p-0 text-xs text-zinc-400 sm:gap-x-8">
                {copy.links.map((link) => (
                  <li key={link}>
                    <span>{link}</span>
                  </li>
                ))}
              </ul>
            </div>
          </AnimatedContainer>
        </div>
      </div>
    </footer>
  );
}

type ViewAnimationProps = {
  delay?: number;
  className?: ComponentProps<typeof motion.div>['className'];
  children: ReactNode;
};

function AnimatedContainer({ className, delay = 0.1, children }: ViewAnimationProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ filter: 'blur(4px)', translateY: -8, opacity: 0 }}
      whileInView={{ filter: 'blur(0px)', translateY: 0, opacity: 1 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay, duration: 0.7 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
