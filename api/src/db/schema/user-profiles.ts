import { sql } from 'drizzle-orm';
import { check, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';

export const userProfiles = pgTable('user_profiles', {
  userId:         text('user_id').primaryKey(),
  school:         text('school'),
  graduationYear: smallint('graduation_year'),
  bio:            text('bio'),
  major:          text('major'),
  gpa:            text('gpa'),
  phone:          text('phone'),
  linkedinUrl:    text('linkedin_url'),
  portfolioUrl:   text('portfolio_url'),
  headshotKey:    text('headshot_key'),
  resumeKey:      text('resume_key'),
  updatedAt:      timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  check('user_profiles_school_len',        sql`${t.school} IS NULL OR char_length(${t.school}) <= 256`),
  check('user_profiles_grad_year_range',   sql`${t.graduationYear} IS NULL OR (${t.graduationYear} >= 2000 AND ${t.graduationYear} <= 2100)`),
  check('user_profiles_bio_len',           sql`${t.bio} IS NULL OR char_length(${t.bio}) <= 500`),
  check('user_profiles_major_len',         sql`${t.major} IS NULL OR char_length(${t.major}) <= 128`),
  check('user_profiles_gpa_len',           sql`${t.gpa} IS NULL OR char_length(${t.gpa}) <= 8`),
  check('user_profiles_phone_e164',        sql`${t.phone} IS NULL OR ${t.phone} ~ '^\\+[1-9]\\d{1,14}$'`),
  check('user_profiles_linkedin_url_len',  sql`${t.linkedinUrl} IS NULL OR char_length(${t.linkedinUrl}) <= 256`),
  check('user_profiles_portfolio_url_len', sql`${t.portfolioUrl} IS NULL OR char_length(${t.portfolioUrl}) <= 256`),
  check('user_profiles_headshot_key_len', sql`${t.headshotKey} IS NULL OR char_length(${t.headshotKey}) <= 512`),
  check('user_profiles_resume_key_len',   sql`${t.resumeKey} IS NULL OR char_length(${t.resumeKey}) <= 512`),
]);
