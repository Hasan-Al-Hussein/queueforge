'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { LoginRequestSchema, type LoginRequest } from '@queueforge/contracts';
import { Button, Eye, EyeOff, InputField, LockKeyhole } from '@queueforge/ui';

import { formatProblem } from '../../api/client';
import { useAuth } from '../../providers/auth-provider';

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
      <section className="qf-login-context" aria-labelledby="queueforge-login-title">
        <Link className="qf-brand" href="/" prefetch={false}>
          <span className="qf-brand__mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>
            <strong>QueueForge</strong>
            <small>workflow control</small>
          </span>
        </Link>
        <div>
          <p className="qf-eyebrow">Local operations console</p>
          <h1 id="queueforge-login-title">Move work with proof.</h1>
          <p>
            Inspect tenant-scoped requests from intake through approval, durable queue processing,
            and signed delivery.
          </p>
        </div>
        <ol className="qf-login-rail" aria-label="QueueForge lifecycle">
          <li>
            <strong>Receive</strong>
            <span>Validate and bind an immutable workflow version.</span>
          </li>
          <li>
            <strong>Approve</strong>
            <span>Record an attributable, race-safe decision.</span>
          </li>
          <li>
            <strong>Dispatch</strong>
            <span>Commit the durable outbox before queue handoff.</span>
          </li>
          <li>
            <strong>Deliver</strong>
            <span>Retry signed webhooks with a complete attempt trail.</span>
          </li>
        </ol>
      </section>
      <section className="qf-login-form-wrap" aria-label="Sign in">
        <form className="qf-login-form" onSubmit={(event) => void submit(event)} noValidate>
          <header>
            <p className="qf-eyebrow">Secure session</p>
            <h2>Sign in to a tenant</h2>
            <p>Access tokens stay in memory. The local API rotates the HttpOnly refresh session.</p>
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
              error={errors.email?.message}
              id="email"
              label="Email address"
              required
              type="email"
              {...register('email')}
            />
            <div className="qf-password-field">
              <InputField
                autoComplete="current-password"
                error={errors.password?.message}
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
            QueueForge is a loopback-only demonstration. Use synthetic data, never real secrets.
          </p>
        </form>
      </section>
    </main>
  );
}
