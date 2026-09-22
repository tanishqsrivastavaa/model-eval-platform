/**
 * Feature wiring for the presentational Sidebar — meta/providers, model list
 * with abort-stale guard, presets, controlled form values, submit → POST
 * /api/runs → navigate, and the shared history list.
 *
 * Form values live in a module-level session so the in-progress prompt
 * survives HomePage ↔ RunPage remounts (legacy was a single page).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Sidebar, type SidebarOption, type SidebarValues } from '@/app/Sidebar';
import { refreshHistory, useHistory } from '@/features/history/historyStore';
import { createRun, listModels } from '@/lib/api';
import { buildRunBody } from '@/lib/buildRunBody';
import { PRESETS } from '@/lib/presets';
import { getModel, getProvider, setModel, setProvider } from '@/lib/storage';
import { useMeta } from './metaStore';

const EMPTY_VALUES: SidebarValues = {
  provider: '',
  model: '',
  prompt: '',
  system: '',
  preset: '',
  tools: [],
  max_turns: '10',
  temperature: '',
  max_tokens: '',
  reasoning_effort: '',
  tool_delay_ms: '0',
  tool_failure_rate: '0',
};

const PRESET_OPTIONS: SidebarOption[] = PRESETS.map(([label], i) => ({
  value: String(i),
  label,
}));

interface SidebarSession {
  values: SidebarValues;
  models: string[];
  modelHint: string | undefined;
}

let session: SidebarSession | null = null;

export function __resetSidebarSessionForTests(): void {
  session = null;
}

export interface ConnectedSidebarProps {
  activeId?: string | null;
}

export function ConnectedSidebar({ activeId = null }: ConnectedSidebarProps) {
  const navigate = useNavigate();
  const meta = useMeta();
  const runs = useHistory();

  const [values, setValuesState] = useState<SidebarValues>(() => session?.values ?? EMPTY_VALUES);
  const [models, setModelsState] = useState<string[]>(() => session?.models ?? []);
  const [modelHint, setModelHintState] = useState<string | undefined>(() => session?.modelHint);
  const [providerOptions, setProviderOptions] = useState<SidebarOption[]>([]);
  const [toolOptions, setToolOptions] = useState<SidebarOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const setValues = useCallback((next: SidebarValues) => {
    session = { values: next, models: session?.models ?? [], modelHint: session?.modelHint };
    setValuesState(next);
  }, []);

  const setModels = useCallback((next: string[]) => {
    session = {
      values: session?.values ?? EMPTY_VALUES,
      models: next,
      modelHint: session?.modelHint,
    };
    setModelsState(next);
  }, []);

  const setModelHint = useCallback((next: string | undefined) => {
    session = {
      values: session?.values ?? EMPTY_VALUES,
      models: session?.models ?? [],
      modelHint: next,
    };
    setModelHintState(next);
  }, []);

  const modelsToken = useRef(0);

  const loadModels = useCallback(
    (provider: string) => {
      const token = ++modelsToken.current;
      setModels([]);
      setModelHint('loading models…');
      listModels(provider)
        .then((ids) => {
          if (modelsToken.current !== token) return; // a newer provider took over
          setModels(ids);
          setModelHint(
            `${ids.length} models${provider === 'openrouter' ? ' with tool support' : ''} — type to filter`,
          );
        })
        .catch((err: unknown) => {
          if (modelsToken.current !== token) return;
          setModelHint(`couldn't list models: ${err instanceof Error ? err.message : String(err)}`);
        });
    },
    [setModels, setModelHint],
  );

  useEffect(() => {
    if (!meta) return;
    setProviderOptions(meta.providers.map((p) => ({ value: p.id, label: p.label })));
    setToolOptions(meta.tools.map((t) => ({ value: t.name, label: t.name })));
    if (session) return; // form state already restored from a previous mount
    const stored = getProvider();
    const provider =
      stored && meta.providers.some((p) => p.id === stored)
        ? stored
        : (meta.providers[0]?.id ?? '');
    setValues({
      ...EMPTY_VALUES,
      provider,
      system: meta.default_system,
      tools: meta.tools.map((t) => t.name),
      model: provider ? (getModel(provider) ?? '') : '',
    });
    if (provider) loadModels(provider);
    else setModelHint('');
  }, [meta, loadModels, setValues, setModelHint]);

  useEffect(() => {
    void refreshHistory();
  }, []);

  const handleChange = (next: SidebarValues) => {
    const prev = values;
    let patched = next;

    if (patched.provider !== prev.provider) {
      if (patched.provider) {
        setProvider(patched.provider);
        const storedModel = getModel(patched.provider);
        patched = { ...patched, model: storedModel ?? '' };
        setValues(patched);
        loadModels(patched.provider);
      } else {
        setValues(patched);
        modelsToken.current += 1;
        setModels([]);
        setModelHint('');
      }
      return;
    }

    if (patched.preset !== prev.preset && patched.preset !== '') {
      const preset = PRESETS[Number(patched.preset)];
      if (preset) patched = { ...patched, prompt: preset[1] };
    }
    setValues(patched);
  };

  const handleSubmit = (formValues: SidebarValues) => {
    if (!formValues.provider || !formValues.model.trim()) return;
    if (meta && meta.providers.length === 0) return; // no providers configured
    const allToolNames = meta ? meta.tools.map((t) => t.name) : [];
    setFormError(null);
    setBusy(true);
    setModel(formValues.provider, formValues.model.trim());
    createRun(buildRunBody(formValues, allToolNames))
      .then(({ id }) => {
        navigate(`/runs/${id}`);
        void refreshHistory();
      })
      .catch((err: unknown) => {
        setFormError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Sidebar
      providers={providerOptions}
      models={models}
      presets={PRESET_OPTIONS}
      tools={toolOptions}
      modelHint={modelHint}
      runs={runs}
      activeId={activeId}
      values={values}
      onChange={handleChange}
      onSubmit={handleSubmit}
      onOpenRun={(id) => navigate(`/runs/${id}`)}
      formError={formError}
      busy={busy}
    />
  );
}
