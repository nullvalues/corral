import { useState, useEffect, useRef } from 'react';
import { z } from 'zod';
import {
  useMyProfile,
  useMyHeadshot,
  useUploadHeadshot,
} from '../hooks/useMyProfile.js';
import { useUpdateMyProfile } from '../hooks/useUpdateMyProfile.js';
import { useMyResume, useUploadResume, useDeleteResume } from '../hooks/useResume.js';
import { getInitials } from '../lib/initials.js';

const MAX_HEADSHOT_BYTES = 5 * 1024 * 1024;
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

/** Maps a headshot-upload error status to a human message; null for none. */
function headshotErrorMessage(status: number | undefined): string | null {
  if (status === 413) return 'Image too large — max 5 MB';
  if (status === 415) return 'Unsupported image type';
  return null;
}

/** Maps a resume-upload error status to a human message; null for none. */
function resumeErrorMessage(status: number | undefined): string | null {
  if (status === 413) return 'Max 10 MB';
  if (status === 415) return 'PDF only';
  return null;
}

const PHONE_RE = /^\+[1-9]\d{1,14}$/;

// Field-level schemas. Empty input is allowed (optional) for every added field;
// non-empty input must satisfy the constraint or submit is blocked.
const majorSchema = z
  .string()
  .max(128, 'Major must be 128 characters or fewer.');

const phoneSchema = z
  .string()
  .regex(PHONE_RE, 'Enter a phone number in the format +15555550100.');

const urlSchema = (label: string) =>
  z
    .string()
    .max(256, `${label} must be 256 characters or fewer.`)
    .refine(
      (v) => /^https?:\/\//i.test(v),
      { message: `Enter a valid ${label} (including https://).` },
    );

type FieldErrors = {
  major?: string;
  phone?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
};

export function ProfilePage() {
  const { data: profile, isLoading } = useMyProfile();
  const { mutate: updateProfile, isPending, isSuccess, isError, reset } = useUpdateMyProfile();

  const { data: headshot } = useMyHeadshot();
  const { mutate: uploadHeadshot, isPending: isUploading } = useUploadHeadshot();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [headshotError, setHeadshotError] = useState<string | null>(null);

  const { data: resume } = useMyResume();
  const { mutate: uploadResume, isPending: isUploadingResume } = useUploadResume();
  const { mutate: deleteResume, isPending: isDeletingResume } = useDeleteResume();
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const [name, setName]                     = useState('');
  const [school, setSchool]                 = useState('');
  const [graduationYear, setGraduationYear] = useState('');
  const [bio, setBio]                       = useState('');
  const [major, setMajor]                   = useState('');
  const [phone, setPhone]                   = useState('');
  const [linkedinUrl, setLinkedinUrl]       = useState('');
  const [portfolioUrl, setPortfolioUrl]     = useState('');
  const [errors, setErrors]                 = useState<FieldErrors>({});

  useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(() => reset(), 3000);
    return () => clearTimeout(timer);
  }, [isSuccess, reset]);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? '');
    setSchool(profile.school ?? '');
    setGraduationYear(profile.graduationYear != null ? String(profile.graduationYear) : '');
    setBio(profile.bio ?? '');
    setMajor(profile.major ?? '');
    setPhone(profile.phone ?? '');
    setLinkedinUrl(profile.linkedinUrl ?? '');
    setPortfolioUrl(profile.portfolioUrl ?? '');
  }, [profile]);

  function validate(): FieldErrors | null {
    const next: FieldErrors = {};

    if (major.trim()) {
      const r = majorSchema.safeParse(major.trim());
      if (!r.success) next.major = r.error.issues[0]?.message;
    }
    if (phone.trim()) {
      const r = phoneSchema.safeParse(phone.trim());
      if (!r.success) next.phone = r.error.issues[0]?.message;
    }
    if (linkedinUrl.trim()) {
      const r = urlSchema('LinkedIn URL').safeParse(linkedinUrl.trim());
      if (!r.success) next.linkedinUrl = r.error.issues[0]?.message;
    }
    if (portfolioUrl.trim()) {
      const r = urlSchema('portfolio URL').safeParse(portfolioUrl.trim());
      if (!r.success) next.portfolioUrl = r.error.issues[0]?.message;
    }

    return Object.keys(next).length > 0 ? next : null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = validate();
    setErrors(invalid ?? {});
    if (invalid) return;

    const year = graduationYear.trim() ? Number(graduationYear) : null;
    updateProfile({
      name: name.trim() || undefined,
      school: school.trim() || null,
      graduationYear: year,
      bio: bio.trim() || null,
      major: major.trim() || null,
      phone: phone.trim() || null,
      linkedinUrl: linkedinUrl.trim() || null,
      portfolioUrl: portfolioUrl.trim() || null,
    });
  }

  useEffect(() => {
    if (!headshotError) return;
    const timer = setTimeout(() => setHeadshotError(null), 4000);
    return () => clearTimeout(timer);
  }, [headshotError]);

  useEffect(() => {
    if (!resumeError) return;
    const timer = setTimeout(() => setResumeError(null), 4000);
    return () => clearTimeout(timer);
  }, [resumeError]);

  function handleHeadshotChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input value so selecting the same file again re-fires onChange.
    e.target.value = '';
    if (!file) return;

    setHeadshotError(null);

    // Fail fast on oversized files client-side before the round-trip.
    if (file.size > MAX_HEADSHOT_BYTES) {
      setHeadshotError('Image too large — max 5 MB');
      return;
    }

    uploadHeadshot(file, {
      onError: (err) => {
        setHeadshotError(
          headshotErrorMessage(err.status) ?? 'Could not upload photo. Please try again.',
        );
      },
    });
  }

  function handleResumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setResumeError(null);

    if (file.size > MAX_RESUME_BYTES) {
      setResumeError('Max 10 MB');
      return;
    }

    uploadResume(file, {
      onError: (err) => {
        setResumeError(
          resumeErrorMessage((err as { status?: number }).status) ?? 'Could not upload resume. Please try again.',
        );
      },
    });
  }

  function handleResumeRemove() {
    if (!window.confirm('Remove your uploaded resume?')) return;
    deleteResume();
  }

  if (isLoading) {
    return <div className="p-6 text-text-muted">Loading…</div>;
  }

  const inputClass =
    'w-full rounded border border-primary-300 bg-surface-base px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-focus-ring';

  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="mb-6 font-display text-2xl font-bold text-ink">Your profile</h1>
      {/* Headshot */}
      <div className="mb-6 flex items-center gap-4">
        <div className="relative">
          {headshot?.url ? (
            <img
              src={headshot.url}
              alt="Profile photo"
              className="h-20 w-20 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-500 text-xl font-semibold text-white">
              {getInitials(name)}
            </div>
          )}
          {isUploading && (
            <div
              role="status"
              aria-label="Uploading photo"
              className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-xs text-white"
            >
              Uploading…
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleHeadshotChange}
            className="hidden"
            data-testid="headshot-file-input"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="self-start rounded-xl border border-primary-300 px-4 py-2 text-sm font-semibold text-primary-600 hover:bg-primary-50 disabled:opacity-50"
          >
            {isUploading ? 'Uploading…' : 'Upload photo'}
          </button>
          {headshotError && (
            <p role="alert" className="text-sm text-danger-700">
              {headshotError}
            </p>
          )}
        </div>
      </div>

      {/* Resume */}
      <div className="mb-6 flex flex-col gap-2">
        <p className="text-sm font-medium text-text-default">Resume (PDF)</p>
        {resume ? (
          <div className="flex flex-wrap items-center gap-3">
            <span data-testid="resume-uploaded-label" className="text-sm text-text-default">
              Resume uploaded
            </span>
            <a
              data-testid="resume-view-link"
              href={resume.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-primary-600 underline hover:text-primary-700"
            >
              View
            </a>
            <button
              type="button"
              data-testid="resume-remove-btn"
              disabled={isDeletingResume}
              onClick={handleResumeRemove}
              className="text-sm font-medium text-danger-700 hover:text-danger-800 disabled:opacity-50"
            >
              {isDeletingResume ? 'Removing…' : 'Remove'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <input
              ref={resumeInputRef}
              type="file"
              accept=".pdf"
              onChange={handleResumeChange}
              className="hidden"
              data-testid="resume-file-input"
            />
            <button
              type="button"
              data-testid="resume-upload-btn"
              onClick={() => resumeInputRef.current?.click()}
              disabled={isUploadingResume}
              className="self-start rounded-xl border border-primary-300 px-4 py-2 text-sm font-semibold text-primary-600 hover:bg-primary-50 disabled:opacity-50"
            >
              {isUploadingResume ? 'Uploading…' : 'Upload resume (PDF)'}
            </button>
          </div>
        )}
        {resumeError && (
          <p role="alert" data-testid="resume-error" className="text-sm text-danger-700">
            {resumeError}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Name */}
        <div>
          <label htmlFor="profile-name" className="mb-1 block text-sm font-medium text-text-default">
            Full name
          </label>
          <input
            id="profile-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={128}
            required
            className={inputClass}
          />
        </div>

        {/* School */}
        <div>
          <label htmlFor="profile-school" className="mb-1 block text-sm font-medium text-text-default">
            School
          </label>
          <input
            id="profile-school"
            type="text"
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            maxLength={256}
            className={inputClass}
          />
        </div>

        {/* Major */}
        <div>
          <label htmlFor="profile-major" className="mb-1 block text-sm font-medium text-text-default">
            Major
          </label>
          <input
            id="profile-major"
            type="text"
            value={major}
            onChange={(e) => setMajor(e.target.value)}
            maxLength={128}
            className={inputClass}
          />
          {errors.major && (
            <p className="mt-1 text-sm text-danger-700">{errors.major}</p>
          )}
        </div>

        {/* Graduation year */}
        <div>
          <label htmlFor="profile-grad-year" className="mb-1 block text-sm font-medium text-text-default">
            Graduation year
          </label>
          <input
            id="profile-grad-year"
            type="number"
            value={graduationYear}
            onChange={(e) => setGraduationYear(e.target.value)}
            min={2000}
            max={2100}
            className={inputClass}
          />
        </div>

        {/* Phone */}
        <div>
          <label htmlFor="profile-phone" className="mb-1 block text-sm font-medium text-text-default">
            Phone
          </label>
          <input
            id="profile-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-describedby="profile-phone-hint"
            className={inputClass}
          />
          <p id="profile-phone-hint" className="mt-1 text-xs text-text-muted">
            Format: +15555550100
          </p>
          {errors.phone && (
            <p className="mt-1 text-sm text-danger-700">{errors.phone}</p>
          )}
        </div>

        {/* LinkedIn URL */}
        <div>
          <label htmlFor="profile-linkedin" className="mb-1 block text-sm font-medium text-text-default">
            LinkedIn URL
          </label>
          <input
            id="profile-linkedin"
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            maxLength={256}
            className={inputClass}
          />
          {errors.linkedinUrl && (
            <p className="mt-1 text-sm text-danger-700">{errors.linkedinUrl}</p>
          )}
        </div>

        {/* Portfolio URL */}
        <div>
          <label htmlFor="profile-portfolio" className="mb-1 block text-sm font-medium text-text-default">
            Portfolio URL
          </label>
          <input
            id="profile-portfolio"
            type="url"
            value={portfolioUrl}
            onChange={(e) => setPortfolioUrl(e.target.value)}
            maxLength={256}
            className={inputClass}
          />
          {errors.portfolioUrl && (
            <p className="mt-1 text-sm text-danger-700">{errors.portfolioUrl}</p>
          )}
        </div>

        {/* Bio */}
        <div>
          <label htmlFor="profile-bio" className="mb-1 block text-sm font-medium text-text-default">
            Bio
          </label>
          <textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={500}
            rows={4}
            className={inputClass}
          />
          <p className="mt-1 text-right text-xs text-text-muted">{bio.length}/500</p>
        </div>

        {isSuccess && (
          <p className="text-sm text-success-700">Profile saved.</p>
        )}
        {isError && (
          <p className="text-sm text-danger-700">Could not save profile. Please try again.</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-xl bg-primary-500 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  );
}
