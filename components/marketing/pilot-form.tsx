'use client';

import { useState } from 'react';
import {
  CHALLENGES,
  EMPLOYEE_RANGES,
  ENGINEERING_RANGES,
  RENEWAL_TIMINGS,
  SPEND_RANGES,
} from '@/lib/pilot-schema';
import { cn } from '@/lib/utils';

export function PilotForm({ supportEmail }: { supportEmail: string }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    setStatus('sending');
    setErrors({});
    setFormError(null);

    try {
      const response = await fetch('/api/pilot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      const payload = await response.json();

      if (!response.ok) {
        setErrors(payload.fieldErrors ?? {});
        setFormError(typeof payload.error === 'string' ? payload.error : 'Something went wrong.');
        setStatus('idle');
        return;
      }

      setStatus('sent');
      form.reset();
    } catch {
      setFormError('The request could not be sent. Please try again.');
      setStatus('idle');
    }
  };

  if (status === 'sent') {
    return (
      <div className="rounded-xl border border-positive/30 bg-positive-soft px-6 py-10 text-center">
        <p className="text-[18px] font-semibold tracking-[-0.02em] text-fg">Request received</p>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-fg-muted">
          We will be in touch to scope a 30-day pilot against your own usage and contract data. If you would
          like to add anything in the meantime, reply to us at{' '}
          <a href={`mailto:${supportEmail}`} className="text-accent underline underline-offset-2">
            {supportEmail}
          </a>
          .
        </p>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="mt-5 rounded-md border border-border px-4 py-2 text-[12.5px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          Submit another request
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-surface px-6 py-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" error={errors.name} required>
          <input {...inputProps} name="name" autoComplete="name" />
        </Field>

        <Field label="Work email" name="workEmail" error={errors.workEmail} required>
          <input {...inputProps} name="workEmail" type="email" autoComplete="email" />
        </Field>

        <Field label="Company" name="company" error={errors.company} required>
          <input {...inputProps} name="company" autoComplete="organization" />
        </Field>

        <Field label="Job title" name="jobTitle" error={errors.jobTitle} required>
          <input {...inputProps} name="jobTitle" autoComplete="organization-title" />
        </Field>

        <Field label="Approximate employees" name="approximateEmployees" error={errors.approximateEmployees} required>
          <select {...selectProps} name="approximateEmployees" defaultValue={EMPLOYEE_RANGES[2]}>
            {EMPLOYEE_RANGES.map((range) => (
              <option key={range}>{range}</option>
            ))}
          </select>
        </Field>

        <Field label="Engineering employees" name="engineeringEmployees" error={errors.engineeringEmployees} required>
          <select {...selectProps} name="engineeringEmployees" defaultValue={ENGINEERING_RANGES[1]}>
            {ENGINEERING_RANGES.map((range) => (
              <option key={range}>{range}</option>
            ))}
          </select>
        </Field>

        <Field label="Engineering software spend" name="softwareSpendRange" error={errors.softwareSpendRange} required>
          <select {...selectProps} name="softwareSpendRange" defaultValue={SPEND_RANGES[1]}>
            {SPEND_RANGES.map((range) => (
              <option key={range}>{range}</option>
            ))}
          </select>
        </Field>

        <Field label="Next renewal" name="renewalTiming" error={errors.renewalTiming} required>
          <select {...selectProps} name="renewalTiming" defaultValue={RENEWAL_TIMINGS[2]}>
            {RENEWAL_TIMINGS.map((timing) => (
              <option key={timing}>{timing}</option>
            ))}
          </select>
        </Field>

        <Field
          label="Major software vendors"
          name="majorVendors"
          hint="Optional — for example Ansys, Siemens, Dassault"
          error={errors.majorVendors}
          className="sm:col-span-2"
        >
          <input {...inputProps} name="majorVendors" />
        </Field>

        <Field label="Primary challenge" name="primaryChallenge" error={errors.primaryChallenge} required className="sm:col-span-2">
          <select {...selectProps} name="primaryChallenge" defaultValue={CHALLENGES[1]}>
            {CHALLENGES.map((challenge) => (
              <option key={challenge}>{challenge}</option>
            ))}
          </select>
        </Field>

        <Field label="Anything else" name="message" hint="Optional" error={errors.message} className="sm:col-span-2">
          <textarea
            name="message"
            rows={3}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          />
        </Field>
      </div>

      {formError !== null && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
          {formError}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={status === 'sending'}
          className="h-11 rounded-md bg-accent px-6 text-[14px] font-medium text-accent-fg transition-[filter] hover:brightness-110 disabled:opacity-60"
        >
          {status === 'sending' ? 'Sending…' : 'Request a 30-Day Pilot'}
        </button>
        <p className="text-[11.5px] leading-relaxed text-fg-subtle">
          No payment details are collected. We use these details only to scope the pilot.
        </p>
      </div>
    </form>
  );
}

const inputProps = {
  className:
    'h-10 w-full rounded-md border border-border bg-surface px-3 text-[13.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none',
} as const;

const selectProps = {
  className:
    'h-10 w-full rounded-md border border-border bg-surface px-2.5 text-[13.5px] text-fg focus:border-accent focus:outline-none',
} as const;

function Field({
  label,
  name,
  hint,
  error,
  required = false,
  className,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(className)}>
      <label htmlFor={name} className="mb-1.5 block text-[12px] font-medium text-fg">
        {label}
        {required && <span className="ml-1 text-fg-subtle">*</span>}
      </label>
      <div id={name}>{children}</div>
      {hint !== undefined && error === undefined && (
        <p className="mt-1 text-[11.5px] text-fg-subtle">{hint}</p>
      )}
      {error !== undefined && <p className="mt-1 text-[11.5px] text-danger">{error}</p>}
    </div>
  );
}
