import { describe, expect, it } from 'vitest';
import { pilotRequestSchema } from '@/lib/pilot-schema';

const REQUIRED_ONLY = {
  name: 'Dana Reyes',
  workEmail: 'dana@example.com',
  company: 'Test Aerospace',
  jobTitle: 'Engineering Ops Lead',
  softwareSpendRange: '$2M – $10M',
  renewalTiming: 'Within 90 days',
};

describe('pilotRequestSchema — required fields', () => {
  it('accepts a submission with only the required fields', () => {
    const result = pilotRequestSchema.safeParse(REQUIRED_ONLY);
    expect(result.success).toBe(true);
  });

  it('rejects a missing name, email, company or job title', () => {
    for (const field of ['name', 'workEmail', 'company', 'jobTitle'] as const) {
      const payload = { ...REQUIRED_ONLY, [field]: '' };
      expect(pilotRequestSchema.safeParse(payload).success, field).toBe(false);
    }
  });

  it('rejects an invalid email', () => {
    const result = pilotRequestSchema.safeParse({ ...REQUIRED_ONLY, workEmail: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('still requires spend range and renewal timing', () => {
    for (const field of ['softwareSpendRange', 'renewalTiming'] as const) {
      const payload = { ...REQUIRED_ONLY };
      delete (payload as Record<string, unknown>)[field];
      expect(pilotRequestSchema.safeParse(payload).success, field).toBe(false);
    }
  });
});

describe('pilotRequestSchema — optional fields must never block a request', () => {
  const OPTIONAL_SELECTS = ['approximateEmployees', 'engineeringEmployees', 'primaryChallenge'] as const;

  it('accepts optional selects submitted as an empty string', () => {
    // An unselected <select> submits '', which is not a valid enum member.
    // Blank must normalize to undefined rather than fail the form.
    const payload = {
      ...REQUIRED_ONLY,
      approximateEmployees: '',
      engineeringEmployees: '',
      primaryChallenge: '',
      majorVendors: '',
      message: '',
    };
    const result = pilotRequestSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      for (const field of OPTIONAL_SELECTS) {
        expect(result.data[field]).toBeUndefined();
      }
    }
  });

  it('accepts optional selects omitted entirely', () => {
    expect(pilotRequestSchema.safeParse(REQUIRED_ONLY).success).toBe(true);
  });

  it('preserves optional values when they are supplied', () => {
    const result = pilotRequestSchema.safeParse({
      ...REQUIRED_ONLY,
      approximateEmployees: '1,000 – 5,000',
      engineeringEmployees: '500 – 2,000',
      majorVendors: 'Ansys, Siemens',
      primaryChallenge: 'We suspect we are over-licensed',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.approximateEmployees).toBe('1,000 – 5,000');
      expect(result.data.engineeringEmployees).toBe('500 – 2,000');
      expect(result.data.majorVendors).toBe('Ansys, Siemens');
      expect(result.data.primaryChallenge).toBe('We suspect we are over-licensed');
    }
  });

  it('still rejects a genuinely invalid optional value rather than silently dropping it', () => {
    const result = pilotRequestSchema.safeParse({
      ...REQUIRED_ONLY,
      approximateEmployees: 'Nine hundred squillion',
    });
    expect(result.success).toBe(false);
  });

  it('defaults free-text optionals to an empty string', () => {
    const result = pilotRequestSchema.safeParse(REQUIRED_ONLY);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.majorVendors).toBe('');
      expect(result.data.message).toBe('');
    }
  });
});
