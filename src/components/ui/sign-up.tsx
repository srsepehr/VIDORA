import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Testimonial } from '@/components/ui/sign-in';

// --- HELPER COMPONENTS (ICONS) ---

const GoogleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 48 48">
        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s12-5.373 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-2.641-.21-5.236-.611-7.743z" />
        <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
        <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
        <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 44 30.038 44 24c0-2.641-.21-5.236-.611-7.743z" />
    </svg>
);

// --- TYPE DEFINITIONS ---

export interface SignUpLabels {
  nameLabel?: string;
  namePlaceholder?: string;
  emailLabel?: string;
  emailPlaceholder?: string;
  passwordLabel?: string;
  passwordPlaceholder?: string;
  confirmPasswordLabel?: string;
  confirmPasswordPlaceholder?: string;
  agreeToTerms?: string;
  createAccount?: string;
  orContinueWith?: string;
  continueWithGoogle?: string;
  alreadyHaveAccount?: string;
  signIn?: string;
}

const DEFAULT_LABELS: Required<SignUpLabels> = {
  nameLabel: 'Full Name',
  namePlaceholder: 'Enter your full name',
  emailLabel: 'Email Address',
  emailPlaceholder: 'Enter your email address',
  passwordLabel: 'Password',
  passwordPlaceholder: 'Create a password',
  confirmPasswordLabel: 'Confirm Password',
  confirmPasswordPlaceholder: 'Repeat your password',
  agreeToTerms: 'I agree to the Terms of Service and Privacy Policy',
  createAccount: 'Create Account',
  orContinueWith: 'Or continue with',
  continueWithGoogle: 'Continue with Google',
  alreadyHaveAccount: 'Already have an account?',
  signIn: 'Sign In',
};

interface SignUpPageProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  heroImageSrc?: string;
  testimonials?: Testimonial[];
  dir?: 'ltr' | 'rtl';
  labels?: SignUpLabels;
  onSignUp?: (event: React.FormEvent<HTMLFormElement>) => void;
  onGoogleSignUp?: () => void;
  onSignIn?: () => void;
}

// --- SUB-COMPONENTS ---

const GlassInputWrapper = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-2xl border border-border bg-foreground/5 backdrop-blur-sm transition-colors focus-within:border-zinc-900/60 focus-within:bg-zinc-900/5 dark:focus-within:border-white/40 dark:focus-within:bg-white/10">
    {children}
  </div>
);

const TestimonialCard = ({ testimonial, delay, dir }: { testimonial: Testimonial, delay: string, dir?: 'ltr' | 'rtl' }) => (
  <div dir={dir} className={`animate-testimonial ${delay} flex items-start gap-3 rounded-3xl bg-card/40 dark:bg-zinc-800/40 backdrop-blur-xl border border-white/10 p-5 w-64`}>
    <img src={testimonial.avatarSrc} className="h-10 w-10 object-cover rounded-2xl" alt="avatar" />
    <div className="text-sm leading-snug">
      <p className="flex items-center gap-1 font-medium">{testimonial.name}</p>
      <p className="text-muted-foreground">{testimonial.handle}</p>
      <p className="mt-1 text-foreground/80">{testimonial.text}</p>
    </div>
  </div>
);

// --- MAIN COMPONENT ---

export const SignUpPage: React.FC<SignUpPageProps> = ({
  title,
  description,
  heroImageSrc,
  testimonials = [],
  dir = 'ltr',
  labels,
  onSignUp,
  onGoogleSignUp,
  onSignIn,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const t = { ...DEFAULT_LABELS, ...labels };
  const heading = title ?? <span className="font-light text-foreground tracking-tighter">Create Account</span>;
  const subheading = description ?? 'Join us and start learning from the world’s best videos';

  const PasswordInput = ({ name, placeholder, show, onToggle }: { name: string, placeholder: string, show: boolean, onToggle: () => void }) => (
    <GlassInputWrapper>
      <div className="relative">
        <input name={name} type={show ? 'text' : 'password'} placeholder={placeholder} className="w-full bg-transparent text-sm p-4 pr-12 rounded-2xl focus:outline-none" />
        <button type="button" onClick={onToggle} className="absolute inset-y-0 right-3 flex items-center">
          {show ? <EyeOff className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" /> : <Eye className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />}
        </button>
      </div>
    </GlassInputWrapper>
  );

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row font-geist w-[100dvw] bg-background text-foreground">
      {/* Left column: sign-up form */}
      <section dir={dir} className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
        <div className="w-full max-w-md">
          <div className="flex flex-col gap-6">
            <h1 className="animate-element animate-delay-100 text-4xl md:text-5xl font-semibold leading-tight">{heading}</h1>
            <p className="animate-element animate-delay-200 text-muted-foreground">{subheading}</p>

            <form className="space-y-5" onSubmit={onSignUp}>
              <div className="animate-element animate-delay-300">
                <label className="text-sm font-medium text-muted-foreground">{t.nameLabel}</label>
                <GlassInputWrapper>
                  <input name="name" type="text" placeholder={t.namePlaceholder} className="w-full bg-transparent text-sm p-4 rounded-2xl focus:outline-none" />
                </GlassInputWrapper>
              </div>

              <div className="animate-element animate-delay-400">
                <label className="text-sm font-medium text-muted-foreground">{t.emailLabel}</label>
                <GlassInputWrapper>
                  <input name="email" type="email" placeholder={t.emailPlaceholder} className="w-full bg-transparent text-sm p-4 rounded-2xl focus:outline-none" />
                </GlassInputWrapper>
              </div>

              <div className="animate-element animate-delay-500">
                <label className="text-sm font-medium text-muted-foreground">{t.passwordLabel}</label>
                <PasswordInput name="password" placeholder={t.passwordPlaceholder} show={showPassword} onToggle={() => setShowPassword(!showPassword)} />
              </div>

              <div className="animate-element animate-delay-600">
                <label className="text-sm font-medium text-muted-foreground">{t.confirmPasswordLabel}</label>
                <PasswordInput name="confirmPassword" placeholder={t.confirmPasswordPlaceholder} show={showConfirmPassword} onToggle={() => setShowConfirmPassword(!showConfirmPassword)} />
              </div>

              <div className="animate-element animate-delay-700 flex items-center text-sm">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" name="agreeTerms" required className="custom-checkbox" />
                  <span className="text-foreground/90">{t.agreeToTerms}</span>
                </label>
              </div>

              <button type="submit" className="animate-element animate-delay-800 w-full rounded-2xl bg-primary py-4 font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                {t.createAccount}
              </button>
            </form>

            <div className="animate-element animate-delay-900 relative flex items-center justify-center">
              <span className="w-full border-t border-border"></span>
              <span className="px-4 text-sm text-muted-foreground bg-background absolute">{t.orContinueWith}</span>
            </div>

            <button onClick={onGoogleSignUp} className="animate-element animate-delay-1000 w-full flex items-center justify-center gap-3 border border-border rounded-2xl py-4 hover:bg-secondary transition-colors">
                <GoogleIcon />
                {t.continueWithGoogle}
            </button>

            <p className="animate-element animate-delay-1000 text-center text-sm text-muted-foreground">
              {t.alreadyHaveAccount} <a href="#" onClick={(e) => { e.preventDefault(); onSignIn?.(); }} className="text-zinc-900 dark:text-zinc-100 font-medium hover:underline transition-colors">{t.signIn}</a>
            </p>
          </div>
        </div>
      </section>

      {/* Right column: hero image + testimonials */}
      {heroImageSrc && (
        <section className="hidden md:block flex-1 relative">
          <div className="animate-slide-right animate-delay-300 absolute inset-0 bg-cover bg-center grayscale" style={{ backgroundImage: `url(${heroImageSrc})` }}></div>
          {testimonials.length > 0 && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-4 px-8 w-full justify-center">
              <TestimonialCard testimonial={testimonials[0]} delay="animate-delay-1200" dir={dir} />
              {testimonials[1] && <div className="hidden xl:flex"><TestimonialCard testimonial={testimonials[1]} delay="animate-delay-1400" dir={dir} /></div>}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
