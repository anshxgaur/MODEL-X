import { ModelCategory } from '@runanywhere/web';
import {
  ToolCalling,
  ToolCallFormat,
  toToolValue,
  type ToolDefinition,
  type ToolCall,
  type ToolResult,
  type ToolCallingResult,
  type ToolValue,
} from '@runanywhere/web-llamacpp';
import { useState, useRef, useEffect, useCallback } from 'react';

import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import { ALL_DEMO_TOOLS } from '../services/demo_tools';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface TraceStep {
  type: 'user' | 'tool_call' | 'tool_result' | 'response';
  content: string;
  detail?: ToolCall | ToolResult;
}

interface ParamDraft {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

const EMPTY_PARAM: ParamDraft = { name: '', type: 'string', description: '', required: true };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ToolsTab() {
  const loader = useModelLoader(ModelCategory.Language);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [autoExecute, setAutoExecute] = useState(true);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [registeredTools, setRegisteredTools] = useState<ToolDefinition[]>([]);
  const [showToolForm, setShowToolForm] = useState(false);
  const [showRegistry, setShowRegistry] = useState(false);
  const traceRef = useRef<HTMLDivElement>(null);

  // Custom tool form state
  const [toolName, setToolName] = useState('');
  const [toolDesc, setToolDesc] = useState('');
  const [toolParams, setToolParams] = useState<ParamDraft[]>([{ ...EMPTY_PARAM }]);

  // 1. Register tools from the new service on mount
  useEffect(() => {
    ToolCalling.clearTools();
    for (const { def, executor } of ALL_DEMO_TOOLS) {
      ToolCalling.registerTool(def, executor);
    }
    setRegisteredTools(ToolCalling.getRegisteredTools());
    return () => { ToolCalling.clearTools(); };
  }, []);

  // 2. Auto-scroll the trace window as new steps appear
  useEffect(() => {
    traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight, behavior: 'smooth' });
  }, [trace]);

  const refreshRegistry = useCallback(() => {
    setRegisteredTools(ToolCalling.getRegisteredTools());
  }, []);

  // 3. Execution Logic
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || generating) return;

    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) return;
    }

    setInput('');
    setGenerating(true);
    setTrace([{ type: 'user', content: text }]);

    try {
      const result: ToolCallingResult = await ToolCalling.generateWithTools(text, {
        autoExecute,
        maxToolCalls: 5,
        temperature: 0.3,
        maxTokens: 512,
        format: ToolCallFormat.Default,
      });

      const steps: TraceStep[] = [{ type: 'user', content: text }];
      
      for (let i = 0; i < result.toolCalls.length; i++) {
        const call = result.toolCalls[i];
        steps.push({
          type: 'tool_call',
          content: `${call.toolName}`,
          detail: call,
        });

        if (result.toolResults[i]) {
          const res = result.toolResults[i];
          steps.push({
            type: 'tool_result',
            content: res.success 
              ? JSON.stringify(res.result, null, 2) 
              : `Error: ${res.error}`,
            detail: res,
          });
        }
      }

      if (result.text) {
        steps.push({ type: 'response', content: result.text });
      }
      setTrace(steps);
    } catch (err) {
      setTrace((prev) => [...prev, { type: 'response', content: `Error: ${err}` }]);
    } finally {
      setGenerating(false);
    }
  }, [input, generating, autoExecute, loader]);

  // 4. Custom Tool Creation Helpers
  const addParam = () => setToolParams((p) => [...p, { ...EMPTY_PARAM }]);

  const updateParam = (idx: number, field: keyof ParamDraft, value: string | boolean) => {
    setToolParams((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  };

  const removeParam = (idx: number) => {
    setToolParams((prev) => prev.filter((_, i) => i !== idx));
  };

  const registerCustomTool = () => {
    const name = toolName.trim().replace(/\s+/g, '_').toLowerCase();
    const desc = toolDesc.trim();
    if (!name || !desc) return;

    const params = toolParams
      .filter((p) => p.name.trim())
      .map((p) => ({
        name: p.name.trim(),
        type: p.type as 'string' | 'number' | 'boolean',
        description: p.description.trim() || p.name.trim(),
        required: p.required,
      }));

    const def: ToolDefinition = { name, description: desc, parameters: params, category: 'Custom' };

    // Mock executor for runtime-created tools
    const executor = async (args: Record<string, ToolValue>) => {
      const result: Record<string, ToolValue> = { status: toToolValue('executed'), tool: toToolValue(name) };
      for (const [k, v] of Object.entries(args)) { result[`input_${k}`] = v; }
      return result;
    };

    ToolCalling.registerTool(def, executor);
    refreshRegistry();
    setToolName('');
    setToolDesc('');
    setToolParams([{ ...EMPTY_PARAM }]);
    setShowToolForm(false);
  };

  const unregisterTool = (name: string) => {
    ToolCalling.unregisterTool(name);
    refreshRegistry();
  };

  return (
    <div className="tab-panel tools-panel">
      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="LLM"
      />

      <div className="tools-toolbar">
        <button className={`btn btn-sm ${showRegistry ? 'btn-primary' : ''}`} onClick={() => { setShowRegistry(!showRegistry); setShowToolForm(false); }}>🔧 Tools ({registeredTools.length})</button>
        <button className={`btn btn-sm ${showToolForm ? 'btn-primary' : ''}`} onClick={() => { setShowToolForm(!showToolForm); setShowRegistry(false); }}>+ Add Tool</button>
        <label className="tools-toggle">
          <input type="checkbox" checked={autoExecute} onChange={(e) => setAutoExecute(e.target.checked)} />
          Auto-execute
        </label>
      </div>

      {showRegistry && (
        <div className="tools-registry">
          {registeredTools.map((t) => (
            <div key={t.name} className="tool-card">
              <div className="tool-card-header">
                <strong>{t.name}</strong>
                <button className="btn btn-sm tool-remove" onClick={() => unregisterTool(t.name)}>×</button>
              </div>
              <p className="tool-card-desc">{t.description}</p>
            </div>
          ))}
        </div>
      )}

      {showToolForm && (
        <div className="tools-form">
          <input className="tools-input" placeholder="Tool name" value={toolName} onChange={(e) => setToolName(e.target.value)} />
          <input className="tools-input" placeholder="Description" value={toolDesc} onChange={(e) => setToolDesc(e.target.value)} />
          <button className="btn btn-sm" onClick={addParam}>+ Param</button>
          <button className="btn btn-primary btn-sm" onClick={registerCustomTool}>Register Tool</button>
        </div>
      )}

      <div className="tools-trace" ref={traceRef}>
        {trace.map((step, i) => (
          <div key={i} className={`trace-step trace-${step.type}`}>
            <div className="trace-label">{step.type.toUpperCase()}</div>
            <div className="trace-content"><pre>{step.content}</pre></div>
          </div>
        ))}
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input type="text" placeholder="Ask something..." value={input} onChange={(e) => setInput(e.target.value)} disabled={generating} />
        <button type="submit" className="btn btn-primary" disabled={!input.trim() || generating}>Send</button>
      </form>
    </div>
  );
}