import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RunAnywhere, SDKEnvironment } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import '../styles/NovaTheme.css';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

interface Memory {
  id: string;
  text: string;
  timestamp: string;
  category: string;
}

export function NovaInterface() {
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'SYSTEM: NOVA core online. 100% Offline Browser Mode Active.' }
  ]);
  const [generating, setGenerating] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [engineReady, setEngineReady] = useState(false);

  const [memories, setMemories] = useState<Memory[]>([]);
  const [newMemory, setNewMemory] = useState('');

  const rightPanelRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);
  const isProcessingRef = useRef(false);

  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SILENCE_DELAY = 1500;

  // ── 1. Initialize RunAnywhere Engine ──
  useEffect(() => {
    const initEngine = async () => {
      try {
        const { LlamaCPP } = await import('@runanywhere/web-llamacpp');
        LlamaCPP.register();

        await RunAnywhere.initialize({
          environment: SDKEnvironment.Development,
          modelBaseUrl: '/wasm/'
        });

        setEngineReady(true);
        console.log('⚡ SYSTEM: LlamaCPP Registered & SDK Initialized');
      } catch (err) {
        console.error('Engine Init Failed:', err);
      }
    };
    initEngine();
  }, []);

  // ── 2. Clock Logic ──
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-IN', { hour12: false }));
      setDate(now.toDateString() + " IST");
    };
    const timer = setInterval(updateClock, 1000);
    updateClock();
    return () => clearInterval(timer);
  }, []);

  // ── Auto scroll ──
  useEffect(() => {
    if (rightPanelRef.current) {
      rightPanelRef.current.scrollTop = rightPanelRef.current.scrollHeight;
    }
  }, [messages]);

  // ── LocalStorage Memory System ──
  const fetchMemories = useCallback(() => {
    const stored = localStorage.getItem('nova_memories');
    if (stored) setMemories(JSON.parse(stored));
  }, []);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const addMemory = useCallback((textToSave?: string) => {
    const text = (typeof textToSave === 'string' ? textToSave : newMemory).trim();
    if (!text) return;

    const newMem: Memory = {
      id: Date.now().toString(),
      text: text,
      timestamp: new Date().toLocaleString('en-IN'),
      category: 'general'
    };

    setMemories(prev => {
      const updated = [newMem, ...prev].slice(0, 50);
      localStorage.setItem('nova_memories', JSON.stringify(updated));
      return updated;
    });
    setNewMemory('');
  }, [newMemory]);

  const deleteMemory = useCallback((id: string) => {
    setMemories(prev => {
      const updated = prev.filter(m => m.id !== id);
      localStorage.setItem('nova_memories', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearAllMemories = useCallback(() => {
    localStorage.removeItem('nova_memories');
    setMemories([]);
  }, []);

  // ── Voice & Speech Utilities ──
  const cleanForSpeech = (text: string): string => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1').replace(/#{1,6}\s/g, '')
      .replace(/\n/g, ' ').trim();
  };

  const stopMic = useCallback(() => {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch { } }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }, []);

  const resumeMic = useCallback(() => {
    if (listening && recognitionRef.current && !isSpeakingRef.current) {
      setTimeout(() => {
        if (listening) try { recognitionRef.current.start(); } catch { }
      }, 800);
    }
  }, [listening]);

  const speakText = useCallback((text: string) => {
    if (!window.speechSynthesis) { resumeMic(); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanForSpeech(text));
    utterance.onstart = () => { setSpeaking(true); isSpeakingRef.current = true; stopMic(); };
    utterance.onend = () => { setSpeaking(false); isSpeakingRef.current = false; isProcessingRef.current = false; resumeMic(); };
    window.speechSynthesis.speak(utterance);
  }, [stopMic, resumeMic]);

  // ── 🧠 LOCAL BROWSER INFERENCE ──
  const sendToNova = useCallback(async (text: string) => {
    if (!engineReady) {
      setMessages(prev => [...prev, { role: 'assistant', text: '⚡ SYSTEM: Engine is still loading models... please wait.' }]);
      return;
    }
    setGenerating(true);
    isProcessingRef.current = true;

    const userMsg: Message = { role: 'user', text };
    const assistantMsg: Message = { role: 'assistant', text: '' };
    setMessages(prev => [...prev, userMsg, assistantMsg]);

    try {
      const memoryContext = memories.length > 0
        ? `User memories: ${memories.map(m => m.text).join('. ')}`
        : '';

      const systemPrompt = `You are NOVA, a friendly offline AI companion. ${memoryContext}. Respond in plain text only.`;
      const prompt = `<|system|>\n${systemPrompt}\n<|user|>\n${text}\n<|assistant|>\n`;

      const { stream } = await TextGeneration.generateStream(prompt, { maxTokens: 200 });

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', text: accumulated };
          return updated;
        });
      }
      speakText(accumulated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', text: `ERROR: ${msg}` };
        return updated;
      });
      isProcessingRef.current = false;
      resumeMic();
    } finally {
      setGenerating(false);
    }
  }, [engineReady, memories, speakText, resumeMic]);

  const processCommandLogic = useCallback(async (text: string) => {
    const lower = text.toLowerCase().trim();
    if (!lower) return;

    if (lower.startsWith('remember ')) {
      const memText = text.replace(/remember /i, '').trim();
      addMemory(memText);
      const msg = `I will remember: ${memText}`;
      setMessages(prev => [...prev, { role: 'user', text }, { role: 'assistant', text: `⚡ SYSTEM: ${msg}` }]);
      speakText(msg);
    } else {
      await sendToNova(text);
    }
    setInputValue('');
  }, [sendToNova, speakText, addMemory]);

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';

    recognition.onresult = (event: any) => {
      if (isSpeakingRef.current || isProcessingRef.current) return;
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      }
      if (finalText) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => { processCommandLogic(finalText.trim()); }, SILENCE_DELAY);
      }
    };

    recognition.onend = () => {
      if (listening && !isSpeakingRef.current && !isProcessingRef.current) {
        try { recognition.start(); } catch { }
      }
    };

    recognitionRef.current = recognition;
    setListening(true);
    try { recognition.start(); } catch { }
  }, [processCommandLogic, listening]);

  const stopListening = useCallback(() => {
    setListening(false);
    stopMic();
  }, [stopMic]);

  const toggleListening = () => listening ? stopListening() : startListening();

  function getStatus() {
    if (speaking) return '🔊 SPEAKING...';
    if (generating) return '⚙️ PROCESSING...';
    if (listening) return '🎙️ LISTENING...';
    return 'SECURE LINK: ACTIVE';
  }

  return (
    <div className="nova-container">
      <div className="top-left">
        NOVA INTERFACE v3.0
        <span style={{ color: '#00ff88', marginLeft: '15px', fontSize: '0.75rem', border: '1px solid #00ff8844', padding: '2px 8px', borderRadius: '4px' }}>
          [CORE: RUN ANYWHERE 🧠]
        </span>
      </div>
      <div className="top-center">{time}</div>
      <div className="date-display">{date}</div>
      <div className="top-right" style={{ color: speaking ? '#00ff88' : listening ? '#ff3cac' : '#00eaff' }}>
        {getStatus()}
      </div>

      <div className="orb-ring"></div>
      <div className="glow-circle" style={{ boxShadow: speaking ? '0 0 60px #00ff88' : generating ? '0 0 60px #ffaa00' : listening ? '0 0 60px #ff3cac' : '0 0 50px #00eaff' }}></div>

      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={panelTitleStyle}>🧠 MEMORY CORE</h3>
          {memories.length > 0 && <button onClick={clearAllMemories} className="memory-clear-btn">CLEAR ALL</button>}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input value={newMemory} onChange={e => setNewMemory(e.target.value)} onKeyDown={e => e.key === 'Enter' && addMemory()} placeholder="Store memory..." className="memory-input" />
          <button onClick={() => addMemory()} className="memory-add-btn">+</button>
        </div>
        {memories.map(mem => (
          <div key={mem.id} className="memory-card">
            <div className="memory-card-text">{mem.text}</div>
            <div className="memory-card-footer">
              <span className="memory-card-time">{mem.timestamp}</span>
              <button onClick={() => deleteMemory(mem.id)} className="memory-delete-btn">✕</button>
            </div>
          </div>
        ))}
      </div>

      <div className="right-panel" ref={rightPanelRef}>
        <h3>SYSTEM LOG</h3>
        {messages.map((msg, idx) => (
          <div key={idx} className={msg.role === 'user' ? 'user-message' : 'ai-message'}>
            {msg.role === 'user' ? `> USER: ${msg.text}` : msg.text}
          </div>
        ))}
      </div>

      <div className="command-center">
        <div className="input-row">
          <textarea
            className="command-input"
            placeholder="ENTER COMMAND..."
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), processCommandLogic(inputValue))}
            disabled={generating}
          />
          <button className={`mic-btn ${listening ? 'mic-active' : ''}`} onClick={toggleListening}>{listening ? '🔴' : '🎙️'}</button>
        </div>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = { position: 'absolute', top: '75px', left: '24px', width: '300px', height: 'calc(100vh - 155px)', background: 'rgba(0,10,20,0.6)', border: '1px solid #00eaff55', borderRadius: '8px', padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 10 };
const panelTitleStyle: React.CSSProperties = { color: '#00ff88', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '3px', borderBottom: '1px solid #00eaff33', paddingBottom: '8px', margin: 0 };