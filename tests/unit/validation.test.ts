import { describe, expect, it } from 'vitest';
import { fieldErrors, hrFieldErrors, hrFieldsSchema, submitFieldsSchema, trackingHashSchema } from '../../src/shared/validation';

const HASH = 'a'.repeat(64);
const valid = { body: 'The forklift horn is broken.', category: 'safety', tag: 'urgent', tracking_hash: HASH, website: '', elapsed_ms: '5000' };

describe('submitFieldsSchema', () => {
  it('accepts a valid submission and trims the body', () => {
    const r = submitFieldsSchema.safeParse({ ...valid, body: '   The forklift horn is broken.   ' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.body).toBe('The forklift horn is broken.');
      expect(r.data.elapsed_ms).toBe(5000);
    }
  });

  it('enforces 10–4000 characters after trimming', () => {
    expect(submitFieldsSchema.safeParse({ ...valid, body: 'too short' }).success).toBe(false);
    expect(submitFieldsSchema.safeParse({ ...valid, body: '          x         ' }).success).toBe(false);
    expect(submitFieldsSchema.safeParse({ ...valid, body: 'x'.repeat(10) }).success).toBe(true);
    expect(submitFieldsSchema.safeParse({ ...valid, body: 'x'.repeat(4000) }).success).toBe(true);
    expect(submitFieldsSchema.safeParse({ ...valid, body: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('accepts every priority tag, including the gentle ones', () => {
    for (const tag of ['just_sayin', 'casual', 'important', 'urgent', 'crucial'])
      expect(submitFieldsSchema.safeParse({ ...valid, tag }).success, tag).toBe(true);
  });

  it('rejects unknown categories and tags', () => {
    expect(submitFieldsSchema.safeParse({ ...valid, category: 'hr' }).success).toBe(false);
    expect(submitFieldsSchema.safeParse({ ...valid, tag: 'meh' }).success).toBe(false);
  });

  it('rejects a filled honeypot', () => {
    expect(submitFieldsSchema.safeParse({ ...valid, website: 'http://spam' }).success).toBe(false);
  });

  it('requires a 64-char lowercase hex tracking hash', () => {
    expect(trackingHashSchema.safeParse(HASH).success).toBe(true);
    expect(trackingHashSchema.safeParse('A'.repeat(64)).success).toBe(false);
    expect(trackingHashSchema.safeParse('a'.repeat(63)).success).toBe(false);
    expect(trackingHashSchema.safeParse('CEDAR-HARBOR-7342').success).toBe(false);
  });

  it('has no field for any identity data', () => {
    const keys = Object.keys(submitFieldsSchema.shape);
    expect(keys.sort()).toEqual(['body', 'category', 'elapsed_ms', 'tag', 'tracking_hash', 'website']);
  });

  it('fieldErrors maps issues to fields with friendly messages', () => {
    const e = fieldErrors({ ...valid, body: 'short', category: '', tag: '' });
    expect(e.body).toMatch(/at least 10/);
    expect(e.category).toBe('Pick a category.');
    expect(e.tag).toBe('Pick how pressing this is.');
  });
});

describe('hrFieldsSchema (named, HR eyes only)', () => {
  const hr = { full_name: '  Sam Rivera ', body: 'I need to talk about a schedule conflict.', tracking_hash: HASH, website: '', elapsed_ms: '5000' };
  it('requires a name and trims it; contact is optional', () => {
    const r = hrFieldsSchema.safeParse(hr);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.full_name).toBe('Sam Rivera');
      expect(r.data.contact).toBeUndefined();
    }
    expect(hrFieldsSchema.safeParse({ ...hr, full_name: ' ' }).success).toBe(false);
    expect(hrFieldsSchema.safeParse({ ...hr, full_name: undefined }).success).toBe(false);
    expect(hrFieldsSchema.safeParse({ ...hr, contact: 'sam@example.com' }).success).toBe(true);
    expect(hrFieldsSchema.safeParse({ ...hr, contact: 'x'.repeat(201) }).success).toBe(false);
  });
  it('gives friendly field errors', () => {
    expect(hrFieldErrors({ ...hr, full_name: '' }).full_name).toBe('Please enter your name.');
    expect(hrFieldErrors({ ...hr, body: 'short' }).body).toMatch(/at least 10/);
  });
});
