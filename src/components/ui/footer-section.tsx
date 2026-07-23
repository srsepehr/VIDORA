import React from 'react';
import { Globe2, Headphones, ShieldCheck } from 'lucide-react';
import './footer-section.css';

export interface VidoraFooterProps {
  locale?: 'fa' | 'en';
}

const footerCopy = {
  fa: {
    homeLabel: 'بازگشت به صفحه اصلی Vidora',
    benefitsLabel: 'مزایای ویدورا',
    navLabel: 'پیوندهای پایانی',
    benefits: [
      [Headphones, 'پشتیبانی همیشه در دسترس', 'برای پرسش‌ها و مشکلات، تیم پشتیبانی آماده راهنمایی شماست.'],
      [ShieldCheck, 'امن و قابل اعتماد', 'حریم خصوصی و امنیت اطلاعات شما در تمام بخش‌های Vidora در اولویت است.'],
      [Globe2, 'یادگیری جهانی', 'محتوای ارزشمند ویدیوهای جهان را با زبان فارسی در اختیار شما قرار می‌دهیم.'],
    ] as const,
    links: [
      ['درباره ما', '#/'],
      ['تماس با ما', '#/dashboard/support'],
      ['قوانین و حریم خصوصی', '#/'],
    ] as const,
    rights: '© ۲۰۲۶ ویدورا. همه حقوق محفوظ است.',
  },
  en: {
    homeLabel: 'Back to the Vidora homepage',
    benefitsLabel: 'Vidora benefits',
    navLabel: 'Footer links',
    benefits: [
      [Headphones, 'Support within reach', 'Our support team is ready to guide you through questions and problems.'],
      [ShieldCheck, 'Safe and reliable', 'Your privacy and information security are a priority throughout Vidora.'],
      [Globe2, 'Global learning', 'We make valuable video knowledge from around the world available in Persian.'],
    ] as const,
    links: [
      ['About us', '#/'],
      ['Contact us', '#/dashboard/support'],
      ['Terms and privacy', '#/'],
    ] as const,
    rights: '© 2026 Vidora. All rights reserved.',
  },
};

export function VidoraFooter({ locale = 'fa' }: VidoraFooterProps) {
  const copy = footerCopy[locale];
  const rtl = locale === 'fa';

  return (
    <footer className="vidora-public-footer" dir={rtl ? 'rtl' : 'ltr'}>
      <section className="vidora-public-footer__benefits" aria-label={copy.benefitsLabel}>
        {copy.benefits.map(([Icon, title, body]) => (
          <div className="vidora-public-footer__benefit" key={title}>
            <Icon size={34} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          </div>
        ))}
      </section>
      <div className="vidora-public-footer__lower">
        <a className="vidora-public-footer__wordmark vidora-wordmark-link" href="#/" aria-label={copy.homeLabel}>
          VIDORA
        </a>
        <nav className="vidora-public-footer__nav" aria-label={copy.navLabel}>
          {copy.links.map(([label, href]) => (
            <a key={label} href={href}>{label}</a>
          ))}
        </nav>
        <p className="vidora-public-footer__rights">{copy.rights}</p>
      </div>
    </footer>
  );
}
