'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { LoginRequestSchema, type LoginRequest } from '@queueforge/contracts';
import { Button, Eye, EyeOff, InputField, LockKeyhole, type QueueRailItem } from '@queueforge/ui';

import { formatProblem } from '../../api/client';
import { BrandMark } from '../../components/brand-mark';
import { HeroReveal } from '../../components/cinematic-motion';
import { useAuth } from '../../providers/auth-provider';
import { DurablePipelineScene } from '../overview/durable-pipeline-scene';

const LOGIN_PROOF_ITEMS = [
  {
    description: 'The request and its schema are locked together.',
    id: 'intake',
    label: 'Intake stamp',
    state: 'complete',
  },
  {
    description: 'An independent witness records the decision.',
    id: 'decision',
    label: 'Witness decision',
    state: 'complete',
  },
  {
    description: 'Retry attempts remain attached to the surviving result.',
    id: 'process',
    label: 'Durable process',
    state: 'complete',
  },
  {
    description: 'The signed receipt keeps its complete lineage.',
    id: 'delivery',
    label: 'Signed receipt',
    state: 'complete',
  },
] as const satisfies readonly QueueRailItem[];

export function LoginScreen(): React.JSX.Element {
  const { login, session, status } = useAuth();
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<LoginRequest>({
    defaultValues: { email: '', password: '' },
    mode: 'onBlur',
    resolver: zodResolver(LoginRequestSchema),
  });

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await login(values);
      router.push('/');
    } catch (error) {
      setSubmitError(formatProblem(error));
    }
  });

  return (
    <main className="qf-login-layout">
      <section className="qf-login-form-wrap" aria-label="Sign in">
        <form className="qf-login-form" onSubmit={(event) => void submit(event)} noValidate>
          <header>
            <Link className="qf-login-form-brand" href="/" prefetch={false}>
              <BrandMark compact />
              <span>QueueForge</span>
            </Link>
            <p className="qf-eyebrow">Secure workspace access</p>
            <h1>Sign in to QueueForge</h1>
            <p>Open the focused workspace assigned to your role.</p>
          </header>
          {session !== null && status === 'authenticated' ? (
            <div className="qf-inline-alert" role="status">
              <LockKeyhole size={18} aria-hidden="true" />
              <p>
                You are already signed in as {session.user.email}. Submitting will replace this
                browser session.
              </p>
            </div>
          ) : null}
          {submitError !== null ? (
            <div className="qf-form-error" role="alert">
              {submitError}
            </div>
          ) : null}
          <div className="qf-form-stack">
            <InputField
              autoComplete="email"
              error={errors.email === undefined ? undefined : 'Enter a valid email address.'}
              id="email"
              label="Email address"
              required
              type="email"
              {...register('email')}
            />
            <div className="qf-password-field">
              <InputField
                autoComplete="current-password"
                error={errors.password === undefined ? undefined : 'Enter at least 12 characters.'}
                id="password"
                label="Password"
                required
                type={showPassword ? 'text' : 'password'}
                {...register('password')}
              />
              <Button
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="qf-password-toggle"
                icon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                onClick={() => setShowPassword((visible) => !visible)}
                tone="quiet"
              />
            </div>
            <Button
              disabled={status === 'bootstrapping'}
              loading={isSubmitting || status === 'bootstrapping'}
              loadingLabel={status === 'bootstrapping' ? 'Restoring session' : 'Signing in'}
              tone="primary"
              type="submit"
            >
              Sign in
            </Button>
          </div>
          <p className="qf-utility" style={{ marginTop: 14 }}>
            Local demonstration · synthetic data only · no public exposure
          </p>
        </form>
      </section>
      <section className="qf-login-context" aria-labelledby="queueforge-proof-title">
        <Link className="qf-brand" href="/" prefetch={false}>
          <BrandMark />
          <span>
            <strong>QueueForge</strong>
            <small>proof in motion</small>
          </span>
        </Link>
        <HeroReveal>
          <div className="qf-login-pitch">
            <p className="qf-eyebrow">Request-to-receipt control</p>
            <h2 id="queueforge-proof-title">
              <span>Proof</span> at every handoff.
            </h2>
            <p>
              Each request keeps its intake, independent decision, retry history, and signed receipt
              connected in one inspectable record.
            </p>
          </div>
          <div className="qf-login-forge">
            <div className="qf-login-forge__caption" aria-hidden="true">
              <span>Attestation forge</span>
            </div>
            <DurablePipelineScene items={LOGIN_PROOF_ITEMS} presentation="login" />
          </div>
        </HeroReveal>
      </section>
    </main>
  );
}
