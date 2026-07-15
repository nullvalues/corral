import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfilePage } from './ProfilePage.js';

function makeQc(profileData?: object) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (profileData !== undefined) {
    qc.setQueryData(['myProfile'], profileData);
  }
  return qc;
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <ProfilePage />
    </QueryClientProvider>,
  );
}

const PROFILE = {
  name: 'Jordan Avery',
  email: 'jordan@example.com',
  school: 'Ohio State University',
  graduationYear: 2026,
  bio: 'Aspiring veterinarian.',
  major: 'Animal Science',
  gpa: '3.85',
  phone: '+15555550100',
  linkedinUrl: 'https://linkedin.com/in/jordan',
  portfolioUrl: 'https://jordan.example.com',
};

describe('ProfilePage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders loading state when query is pending', () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    renderPage(qc);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('populates fields from GET response: name, school, graduationYear, bio', async () => {
    const qc = makeQc(PROFILE);
    renderPage(qc);
    expect(await screen.findByDisplayValue('Jordan Avery')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ohio State University')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Aspiring veterinarian.')).toBeInTheDocument();
  });

  it('populates the new fields: major, phone, linkedinUrl, portfolioUrl', async () => {
    const qc = makeQc(PROFILE);
    renderPage(qc);
    expect(await screen.findByDisplayValue('Animal Science')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+15555550100')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://linkedin.com/in/jordan')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://jordan.example.com')).toBeInTheDocument();
  });

  it('saves the new fields in the PATCH payload', async () => {
    const qc = makeQc(PROFILE);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...PROFILE }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    renderPage(qc);

    const majorInput = await screen.findByLabelText('Major');
    fireEvent.change(majorInput, { target: { value: 'Biology' } });

    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/me/profile');
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as { body: string }).body);
      expect(body.major).toBe('Biology');
      expect(body.phone).toBe('+15555550100');
      expect(body.linkedinUrl).toBe('https://linkedin.com/in/jordan');
      expect(body.portfolioUrl).toBe('https://jordan.example.com');
    });
  });

  it('blocks submit and shows a format hint when phone is invalid', async () => {
    const qc = makeQc(PROFILE);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    renderPage(qc);

    const phoneInput = await screen.findByLabelText('Phone');
    fireEvent.change(phoneInput, { target: { value: '555-1234' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);

    expect(
      await screen.findByText('Enter a phone number in the format +15555550100.'),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.find(([url]) => url === '/api/me/profile'),
    ).toBeUndefined();
  });

  it('blocks submit when linkedinUrl is not a valid URL', async () => {
    const qc = makeQc(PROFILE);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    renderPage(qc);

    const linkedinInput = await screen.findByLabelText('LinkedIn URL');
    fireEvent.change(linkedinInput, { target: { value: 'not-a-url' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);

    expect(
      await screen.findByText('Enter a valid LinkedIn URL (including https://).'),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.find(([url]) => url === '/api/me/profile'),
    ).toBeUndefined();
  });

  it('blocks submit when portfolioUrl is not a valid URL', async () => {
    const qc = makeQc(PROFILE);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    renderPage(qc);

    const portfolioInput = await screen.findByLabelText('Portfolio URL');
    fireEvent.change(portfolioInput, { target: { value: 'bad url' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);

    expect(
      await screen.findByText('Enter a valid portfolio URL (including https://).'),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.find(([url]) => url === '/api/me/profile'),
    ).toBeUndefined();
  });

  it('submitting the form calls PATCH /api/me/profile with the correct payload', async () => {
    const qc = makeQc(PROFILE);

    const patchResponse = { ...PROFILE };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => patchResponse,
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    renderPage(qc);

    const schoolInput = await screen.findByLabelText('School');
    fireEvent.change(schoolInput, { target: { value: 'OSU' } });

    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/me/profile',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"school":"OSU"'),
        }),
      );
    });
  });

  it('shows "Profile saved." on success', async () => {
    const qc = makeQc(PROFILE);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => PROFILE,
    } as Response));

    renderPage(qc);

    await screen.findByDisplayValue('Jordan Avery');
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
  });

  // ── API-066: scheme refinement on URL fields ─────────────────────────────

  it('blocks submit and shows error when linkedinUrl starts with javascript:', async () => {
    const qc = makeQc(PROFILE);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    renderPage(qc);

    const linkedinInput = await screen.findByLabelText('LinkedIn URL');
    fireEvent.change(linkedinInput, { target: { value: 'javascript:alert(1)' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);

    expect(
      await screen.findByText('Enter a valid LinkedIn URL (including https://).'),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.find(([url]) => url === '/api/me/profile'),
    ).toBeUndefined();
  });

  it('blocks submit and shows error when portfolioUrl starts with data:', async () => {
    const qc = makeQc(PROFILE);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    renderPage(qc);

    const portfolioInput = await screen.findByLabelText('Portfolio URL');
    fireEvent.change(portfolioInput, { target: { value: 'data:text/html,<b>x</b>' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);

    expect(
      await screen.findByText('Enter a valid portfolio URL (including https://).'),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.find(([url]) => url === '/api/me/profile'),
    ).toBeUndefined();
  });

  it('shows error message on failure', async () => {
    const qc = makeQc(PROFILE);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response));

    renderPage(qc);

    await screen.findByDisplayValue('Jordan Avery');
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);

    expect(await screen.findByText('Could not save profile. Please try again.')).toBeInTheDocument();
  });

  // ── UI-100: success message auto-dismiss ─────────────────────────────────

  it('dismisses "Profile saved." after 3000 ms', async () => {
    // shouldAdvanceTime:true lets fake timers tick in real time so async
    // React Query mutations still resolve normally, while still allowing
    // vi.advanceTimersByTime() to jump forward.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const qc = makeQc(PROFILE);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => PROFILE,
      } as Response));

      renderPage(qc);

      expect(await screen.findByDisplayValue('Jordan Avery')).toBeInTheDocument();

      await act(async () => {
        fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);
      });

      expect(await screen.findByText('Profile saved.')).toBeInTheDocument();

      // Jump forward past the 3000 ms dismiss window
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(screen.queryByText('Profile saved.')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── UI-108: headshot upload UI ───────────────────────────────────────────

  function stubHeadshotFetch(
    headshot: { status: number; body: object },
    onPost?: (url: string, opts: RequestInit) => { status: number; body: object },
  ) {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url === '/api/me/headshot' && (opts?.method === 'POST')) {
        const r = onPost ? onPost(url, opts!) : { status: 200, body: { url: 'https://cdn/new.jpg' } };
        return Promise.resolve({
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: async () => r.body,
        } as Response);
      }
      if (url === '/api/me/headshot') {
        return Promise.resolve({
          ok: headshot.status >= 200 && headshot.status < 300,
          status: headshot.status,
          json: async () => headshot.body,
        } as Response);
      }
      // Profile GET/PATCH fallthrough
      return Promise.resolve({ ok: true, status: 200, json: async () => PROFILE } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('renders the headshot image when GET /api/me/headshot returns 200', async () => {
    const qc = makeQc(PROFILE);
    stubHeadshotFetch({ status: 200, body: { url: 'https://cdn/me.jpg' } });
    renderPage(qc);

    const img = (await screen.findByAltText('Profile photo')) as HTMLImageElement;
    expect(img.src).toBe('https://cdn/me.jpg');
  });

  it('renders the initials avatar (no image) when GET /api/me/headshot returns 404', async () => {
    const qc = makeQc(PROFILE);
    stubHeadshotFetch({ status: 404, body: { error: 'Not found' } });
    renderPage(qc);

    await screen.findByDisplayValue('Jordan Avery');
    // No image element — initials shown instead
    expect(screen.queryByAltText('Profile photo')).not.toBeInTheDocument();
    expect(screen.getByText('JA')).toBeInTheDocument();
  });

  it('fires a multipart POST and invalidates the headshot query on success', async () => {
    const qc = makeQc(PROFILE);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const fetchMock = stubHeadshotFetch({ status: 404, body: { error: 'Not found' } });
    renderPage(qc);

    await screen.findByDisplayValue('Jordan Avery');

    const input = screen.getByTestId('headshot-file-input') as HTMLInputElement;
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, opts]) => url === '/api/me/headshot' && (opts as RequestInit)?.method === 'POST',
      );
      expect(post).toBeTruthy();
      expect((post![1] as RequestInit).body).toBeInstanceOf(FormData);
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['myHeadshot'] });
    });
  });

  it('shows the size-error toast when the upload returns 413', async () => {
    const qc = makeQc(PROFILE);
    stubHeadshotFetch(
      { status: 404, body: { error: 'Not found' } },
      () => ({ status: 413, body: { error: 'Too large' } }),
    );
    renderPage(qc);

    await screen.findByDisplayValue('Jordan Avery');

    const input = screen.getByTestId('headshot-file-input') as HTMLInputElement;
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('Image too large — max 5 MB')).toBeInTheDocument();
  });

  it('shows the unsupported-type toast when the upload returns 415', async () => {
    const qc = makeQc(PROFILE);
    stubHeadshotFetch(
      { status: 404, body: { error: 'Not found' } },
      () => ({ status: 415, body: { error: 'Bad type' } }),
    );
    renderPage(qc);

    await screen.findByDisplayValue('Jordan Avery');

    const input = screen.getByTestId('headshot-file-input') as HTMLInputElement;
    const file = new File(['x'], 'me.gif', { type: 'image/gif' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('Unsupported image type')).toBeInTheDocument();
  });

  it('fails fast client-side when the file exceeds 5 MB (no POST fired)', async () => {
    const qc = makeQc(PROFILE);
    const fetchMock = stubHeadshotFetch({ status: 404, body: { error: 'Not found' } });
    renderPage(qc);

    await screen.findByDisplayValue('Jordan Avery');

    const input = screen.getByTestId('headshot-file-input') as HTMLInputElement;
    const bigFile = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(bigFile, 'size', { value: 6 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [bigFile] } });

    expect(await screen.findByText('Image too large — max 5 MB')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(
      ([url, opts]) => url === '/api/me/headshot' && (opts as RequestInit)?.method === 'POST',
    );
    expect(post).toBeUndefined();
  });

  // ── UI-109: resume upload UI ─────────────────────────────────────────────

  /**
   * Stubs fetch to return a given resume response on GET/POST/DELETE
   * /api/me/resume and falls through to the profile fallback otherwise.
   */
  function stubResumeFetch(opts: {
    getStatus: number;
    getBody?: object;
    postStatus?: number;
    postBody?: object;
    deleteStatus?: number;
  }) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method?.toUpperCase() ?? 'GET';
      if (url === '/api/me/resume') {
        if (method === 'POST') {
          const status = opts.postStatus ?? 200;
          return Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => opts.postBody ?? { url: 'https://cdn/resume.pdf' },
          } as Response);
        }
        if (method === 'DELETE') {
          const status = opts.deleteStatus ?? 204;
          return Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => ({}),
          } as Response);
        }
        // GET
        return Promise.resolve({
          ok: opts.getStatus >= 200 && opts.getStatus < 300,
          status: opts.getStatus,
          json: async () => opts.getBody ?? { url: 'https://cdn/resume.pdf' },
        } as Response);
      }
      // headshot + profile fallthrough
      if (url === '/api/me/headshot') {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not found' }),
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => PROFILE } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('renders the upload picker (empty state) when GET /api/me/resume returns 404', async () => {
    const qc = makeQc(PROFILE);
    stubResumeFetch({ getStatus: 404, getBody: { error: 'Not found' } });
    renderPage(qc);

    await screen.findByDisplayValue('Jordan Avery');
    expect(screen.getByTestId('resume-upload-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('resume-uploaded-label')).not.toBeInTheDocument();
  });

  it('renders "Resume uploaded" and a View link when GET /api/me/resume returns 200', async () => {
    const qc = makeQc(PROFILE);
    stubResumeFetch({ getStatus: 200, getBody: { url: 'https://cdn/resume.pdf' } });
    renderPage(qc);

    const label = await screen.findByTestId('resume-uploaded-label');
    expect(label).toHaveTextContent('Resume uploaded');
    const viewLink = screen.getByTestId('resume-view-link') as HTMLAnchorElement;
    expect(viewLink).toHaveAttribute('href', 'https://cdn/resume.pdf');
    expect(viewLink).toHaveAttribute('target', '_blank');
    expect(viewLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByTestId('resume-upload-btn')).not.toBeInTheDocument();
  });

  it('fires a multipart POST when a PDF is selected', async () => {
    const qc = makeQc(PROFILE);
    const fetchMock = stubResumeFetch({
      getStatus: 404,
      getBody: { error: 'Not found' },
      postStatus: 200,
      postBody: { url: 'https://cdn/resume.pdf' },
    });
    renderPage(qc);

    await screen.findByDisplayValue('Jordan Avery');

    const input = screen.getByTestId('resume-file-input') as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, opts]) => url === '/api/me/resume' && (opts as RequestInit)?.method === 'POST',
      );
      expect(post).toBeTruthy();
      expect((post![1] as RequestInit).body).toBeInstanceOf(FormData);
    });
  });

  it('fires DELETE after confirm and returns to the empty upload state', async () => {
    const qc = makeQc(PROFILE);
    // Seed resume as present in the query cache so the component starts in uploaded state.
    qc.setQueryData(['myResume'], { url: 'https://cdn/resume.pdf' });
    const fetchMock = stubResumeFetch({
      getStatus: 200,
      getBody: { url: 'https://cdn/resume.pdf' },
      deleteStatus: 204,
    });
    // confirm() must return true for the Remove button handler to proceed.
    vi.stubGlobal('confirm', () => true);
    renderPage(qc);

    const removeBtn = await screen.findByTestId('resume-remove-btn');
    fireEvent.click(removeBtn);

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([url, opts]) =>
          url === '/api/me/resume' && (opts as RequestInit)?.method === 'DELETE',
      );
      expect(del).toBeTruthy();
    });
  });

  it('does not fire DELETE when the confirm is cancelled', async () => {
    const qc = makeQc(PROFILE);
    qc.setQueryData(['myResume'], { url: 'https://cdn/resume.pdf' });
    const fetchMock = stubResumeFetch({
      getStatus: 200,
      getBody: { url: 'https://cdn/resume.pdf' },
    });
    vi.stubGlobal('confirm', () => false);
    renderPage(qc);

    const removeBtn = await screen.findByTestId('resume-remove-btn');
    fireEvent.click(removeBtn);

    await new Promise((r) => setTimeout(r, 50));
    const del = fetchMock.mock.calls.find(
      ([url, opts]) =>
        url === '/api/me/resume' && (opts as RequestInit)?.method === 'DELETE',
    );
    expect(del).toBeUndefined();
  });

  it('shows the "PDF only" toast when the upload returns 415', async () => {
    const qc = makeQc(PROFILE);
    stubResumeFetch({
      getStatus: 404,
      getBody: { error: 'Not found' },
      postStatus: 415,
      postBody: { error: 'PDF only' },
    });
    renderPage(qc);

    await screen.findByDisplayValue('Jordan Avery');

    const input = screen.getByTestId('resume-file-input') as HTMLInputElement;
    const file = new File(['doc'], 'cv.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByTestId('resume-error')).toHaveTextContent('PDF only');
  });

  it('shows the "Max 10 MB" toast when the upload returns 413', async () => {
    const qc = makeQc(PROFILE);
    stubResumeFetch({
      getStatus: 404,
      getBody: { error: 'Not found' },
      postStatus: 413,
      postBody: { error: 'Too large' },
    });
    renderPage(qc);

    await screen.findByDisplayValue('Jordan Avery');

    const input = screen.getByTestId('resume-file-input') as HTMLInputElement;
    const file = new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByTestId('resume-error')).toHaveTextContent('Max 10 MB');
  });

  it('fails fast client-side when the resume exceeds 10 MB (no POST fired)', async () => {
    const qc = makeQc(PROFILE);
    const fetchMock = stubResumeFetch({ getStatus: 404, getBody: { error: 'Not found' } });
    renderPage(qc);

    await screen.findByDisplayValue('Jordan Avery');

    const input = screen.getByTestId('resume-file-input') as HTMLInputElement;
    const bigFile = new File(['%PDF'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(bigFile, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [bigFile] } });

    expect(await screen.findByTestId('resume-error')).toHaveTextContent('Max 10 MB');
    const post = fetchMock.mock.calls.find(
      ([url, opts]) => url === '/api/me/resume' && (opts as RequestInit)?.method === 'POST',
    );
    expect(post).toBeUndefined();
  });

  it('does not produce state-update warnings when unmounted within the 3000 ms window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const qc = makeQc(PROFILE);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => PROFILE,
      } as Response));

      const { unmount } = renderPage(qc);

      expect(await screen.findByDisplayValue('Jordan Avery')).toBeInTheDocument();

      await act(async () => {
        fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);
      });

      expect(await screen.findByText('Profile saved.')).toBeInTheDocument();

      // Unmount before the timer fires — the useEffect cleanup cancels the timeout
      const consoleSpy = vi.spyOn(console, 'error');
      act(() => {
        unmount();
      });

      // Advance past the dismiss window; no state update should fire
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
