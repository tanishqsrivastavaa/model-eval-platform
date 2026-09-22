import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESETS } from '@/lib/presets';
import type { RunMeta } from '@/types/events';
import { __resetSidebarSessionForTests, ConnectedSidebar } from './ConnectedSidebar';
import { __resetMetaForTests } from './metaStore';

const META = {
  providers: [
    { id: 'openai', label: 'OpenAI' },
    { id: 'openrouter', label: 'OpenRouter' },
  ],
  tools: [
    { name: 'calculator', description: 'calc' },
    { name: 'run_python', description: 'python' },
  ],
  default_system: 'You are a careful agent.',
};

const HISTORY: RunMeta[] = [
  {
    id: 'r-done',
    created_at: 1700000000,
    provider: 'openai',
    model: 'gpt-4.1',
    prompt: 'finished prompt',
    config: {
      provider: 'openai',
      model: 'gpt-4.1',
      prompt: 'finished prompt',
      system: '',
      tools: [],
      max_turns: 10,
      temperature: null,
      max_tokens: null,
      reasoning_effort: null,
      tool_delay_ms: 0,
      tool_failure_rate: 0,
    },
    status: 'completed',
    summary: {
      wall_ms: 1500,
      llm_ms: 1000,
      tool_ms: 300,
      overhead_ms: 200,
      llm_calls: 1,
      tool_calls: 0,
      tool_errors: 0,
      prompt_tokens: 10,
      completion_tokens: 5,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cost: null,
      first_ttft_ms: 100,
    },
  },
];

let postedBody: unknown;

function jsonResponse(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => data } as Response;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname}</div>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  postedBody = undefined;
  __resetSidebarSessionForTests();
  __resetMetaForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/meta')) return jsonResponse(META);
      if (url.includes('/api/models?provider=openrouter')) {
        return jsonResponse(['openrouter/model-a', 'openrouter/model-b']);
      }
      if (url.includes('/api/models')) return jsonResponse(['gpt-4.1-mini', 'gpt-4.1']);
      if (url.includes('/api/runs') && init?.method === 'POST') {
        postedBody = JSON.parse(String(init.body));
        return jsonResponse({ id: 'new-run-1' });
      }
      if (url.includes('/api/runs')) return jsonResponse(HISTORY);
      return jsonResponse({ detail: 'not found' }, false);
    }),
  );
});

afterEach(() => {
  cleanup();
});

describe('ConnectedSidebar', () => {
  it('loads meta: providers, tools checked, default system, model hint', async () => {
    render(
      <MemoryRouter>
        <ConnectedSidebar />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect((screen.getByLabelText('Provider') as HTMLSelectElement).value).toBe('openai');
    });
    await screen.findByText('2 models — type to filter');

    expect((document.getElementById('system') as HTMLTextAreaElement).value).toBe(
      'You are a careful agent.',
    );
    expect((document.getElementById('tool-calculator') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('tool-run_python') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText('Model').getAttribute('list')).toBe('model-list');
    expect(screen.getByRole('option', { name: 'Fibonacci via Python' })).toBeTruthy();
  });

  it('restores stored provider, loads its models hint with tool-support suffix', async () => {
    localStorage.setItem('provider', 'openrouter');
    localStorage.setItem('model:openrouter', 'openrouter/model-b');

    render(
      <MemoryRouter>
        <ConnectedSidebar />
      </MemoryRouter>,
    );

    await screen.findByText('2 models with tool support — type to filter');
    expect((screen.getByLabelText('Provider') as HTMLSelectElement).value).toBe('openrouter');
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('openrouter/model-b');
  });

  it('switching provider reloads models and restores that provider model', async () => {
    localStorage.setItem('model:openai', 'gpt-4.1');
    render(
      <MemoryRouter>
        <ConnectedSidebar />
      </MemoryRouter>,
    );
    await screen.findByText('2 models — type to filter');
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('gpt-4.1');

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openrouter' } });
    await screen.findByText('2 models with tool support — type to filter');
    expect(localStorage.getItem('provider')).toBe('openrouter');
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('');
  });

  it('preset select fills the prompt', async () => {
    render(
      <MemoryRouter>
        <ConnectedSidebar />
      </MemoryRouter>,
    );
    await screen.findByText('2 models — type to filter');

    fireEvent.change(screen.getByLabelText('Preset'), { target: { value: '0' } });
    expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe(PRESETS[0][1]);
  });

  it('submit creates the run, stores the model, and navigates to /runs/:id', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ConnectedSidebar />
        <LocationProbe />
        <Routes>
          <Route path="/runs/:id" element={<div data-testid="run-page" />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('2 models — type to filter');

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: '  gpt-4.1-mini  ' } });
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'do the work' } });
    fireEvent.submit(screen.getByTestId('new-run-form'));

    await screen.findByTestId('run-page');
    expect(screen.getByTestId('loc').textContent).toBe('/runs/new-run-1');
    expect(localStorage.getItem('model:openai')).toBe('gpt-4.1-mini');
    expect(postedBody).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      prompt: 'do the work',
      system: 'You are a careful agent.',
      tools: ['calculator', 'run_python'],
      max_turns: 10,
    });
  });

  it('surfaces create errors under the button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/meta')) return jsonResponse(META);
        if (url.includes('/api/models')) return jsonResponse(['gpt-4.1']);
        if (url.includes('/api/runs') && init?.method === 'POST') {
          return jsonResponse({ detail: 'provider rejected the key' }, false);
        }
        return jsonResponse([]);
      }),
    );

    render(
      <MemoryRouter>
        <ConnectedSidebar />
      </MemoryRouter>,
    );
    await screen.findByText('1 models — type to filter');

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4.1' } });
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'hi' } });
    fireEvent.submit(screen.getByTestId('new-run-form'));

    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toBe('provider rejected the key');
  });

  it('renders history items with status dot, model, prompt and wall time', async () => {
    render(
      <MemoryRouter>
        <ConnectedSidebar />
      </MemoryRouter>,
    );

    const list = await screen.findByTestId('history-list');
    expect(list.textContent).toContain('gpt-4.1');
    expect(list.textContent).toContain('finished prompt');
    expect(list.textContent).toContain('1.50s');
  });
});
