import React, { useState, useEffect, useRef, useCallback } from 'react';
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
    { role: 'assistant', text: 'SYSTEM: NOVA core online. Voice & Chat ready.' }
  ]);
  const [generating, setGenerating] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [waitingForVideo, setWaitingForVideo] = useState(false);

  // ── Memory State ──
  const [memories, setMemories] = useState<Memory[]>([]);
  const [newMemory, setNewMemory] = useState('');

  const cancelRef = useRef<AbortController | null>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const waitingForVideoRef = useRef(false);
  const listeningRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);

  // ── VAD: silence detection refs ──
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interimTranscriptRef = useRef('');
  const SILENCE_DELAY = 2500; // fire after 2.5s of silence

  // ── Clock ──
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

  // ── Fetch Memories ──
  const fetchMemories = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:5000/api/memory');
      const data = await res.json();
      setMemories(data.memories || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchMemories();
    const interval = setInterval(fetchMemories, 30000);
    return () => clearInterval(interval);
  }, [fetchMemories]);

  // ── Add Memory ──
  const addMemory = useCallback(async () => {
    const text = newMemory.trim();
    if (!text) return;
    setNewMemory('');
    try {
      await fetch('http://localhost:5000/api/memory/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      fetchMemories();
    } catch {}
  }, [newMemory, fetchMemories]);

  // ── Delete Memory ──
  const deleteMemory = useCallback(async (id: string) => {
    try {
      await fetch('http://localhost:5000/api/memory/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      fetchMemories();
    } catch {}
  }, [fetchMemories]);

  // ── Clear All Memories ──
  const clearAllMemories = useCallback(async () => {
    try {
      await fetch('http://localhost:5000/api/memory/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      fetchMemories();
    } catch {}
  }, [fetchMemories]);

  // ── Strip markdown before speaking ──
  const cleanForSpeech = (text: string): string => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/>\s/g, '')
      .replace(/[-*+]\s/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .trim();
  };

  // ── Speak Response — stops mic while speaking, resumes after ──
  const speakText = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const cleanText = cleanForSpeech(text);

    const trySpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1;

      const preferred =
        voices.find(v => v.name.includes('Neerja')) ||
        voices.find(v => v.name.includes('Online') && v.lang === 'en-IN') ||
        voices.find(v => v.lang === 'en-IN') ||
        voices.find(v => v.name.includes('Online') && v.lang.startsWith('en'));

      if (preferred) {
        utterance.voice = preferred;
        utterance.lang = preferred.lang;
      } else {
        utterance.lang = 'en-IN';
      }

      utterance.onstart = () => {
        setSpeaking(true);
        isSpeakingRef.current = true;
        // Stop mic while NOVA speaks
        if (recognitionRef.current && listeningRef.current) {
          try { recognitionRef.current.stop(); } catch {}
        }
      };

      utterance.onend = () => {
        setSpeaking(false);
        isSpeakingRef.current = false;
        // Resume mic after 800ms echo buffer
        if (listeningRef.current) {
          setTimeout(() => {
            if (listeningRef.current && recognitionRef.current) {
              try { recognitionRef.current.start(); } catch {}
            }
          }, 800);
        }
      };

      utterance.onerror = () => {
        setSpeaking(false);
        isSpeakingRef.current = false;
        if (listeningRef.current) {
          setTimeout(() => {
            if (listeningRef.current && recognitionRef.current) {
              try { recognitionRef.current.start(); } catch {}
            }
          }, 800);
        }
      };

      window.speechSynthesis.speak(utterance);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        trySpeak();
        window.speechSynthesis.onvoiceschanged = null;
      };
    } else {
      trySpeak();
    }
  }, []);

  // ── Send to Groq ──
  const sendToGroq = useCallback(async (text: string) => {
    setGenerating(true);

    const userMsg: Message = { role: 'user', text };
    const assistantMsg: Message = { role: 'assistant', text: '...' };
    setMessages(prev => [...prev, userMsg, assistantMsg]);

    const controller = new AbortController();
    cancelRef.current = controller;

    const memoryContext = memories.length > 0
      ? `\n\nUser memories (use these to personalize responses):\n${memories.map(m => `- ${m.text}`).join('\n')}`
      : '';

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1024,
          stream: true,
          messages: [
            {
              role: 'system',
              content: `You are NOVA, an advanced AI assistant with a sleek futuristic personality. Be helpful, concise, and slightly futuristic in tone. Keep responses short and punchy unless asked for detail. IMPORTANT: Never use markdown formatting like **, *, #, or backticks — write in plain text only.${memoryContext}`
            },
            ...messages.map(m => ({ role: m.role, content: m.text })),
            { role: 'user', content: text }
          ],
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', text: accumulated };
                return updated;
              });
            }
          } catch {}
        }
      }

      speakText(accumulated);

    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', text: `ERROR: ${msg}` };
        return updated;
      });
    } finally {
      cancelRef.current = null;
      setGenerating(false);
    }
  }, [messages, speakText, memories]);

  // ── Process Voice Command ──
  const processVoiceCommand = useCallback(async (transcript: string) => {
    const lower = transcript.toLowerCase();

    if (waitingForVideoRef.current) {
      waitingForVideoRef.current = false;
      setWaitingForVideo(false);
      const searchQuery = encodeURIComponent(transcript);
      window.open(`https://www.youtube.com/results?search_query=${searchQuery}`, '_blank');
      const msg = `Searching YouTube for "${transcript}"`;
      setMessages(prev => [...prev,
        { role: 'user', text: transcript },
        { role: 'assistant', text: `⚡ SYSTEM: ${msg}` }
      ]);
      speakText(msg);
      return;
    }

    if (lower.includes('open youtube')) {
      window.open('https://youtube.com', '_blank');
      const msg = 'Opening YouTube now.';
      setMessages(prev => [...prev,
        { role: 'user', text: transcript },
        { role: 'assistant', text: `⚡ SYSTEM: ${msg}` }
      ]);
      speakText(msg);
      return;
    }

    if (
      lower.includes('play youtube') ||
      lower.includes('play on youtube') ||
      lower.includes('search youtube') ||
      lower.includes('play a song') ||
      lower.includes('play music')
    ) {
      const askMsg = 'Sure! What video or song would you like to play?';
      setMessages(prev => [...prev,
        { role: 'user', text: transcript },
        { role: 'assistant', text: `⚡ SYSTEM: ${askMsg}` }
      ]);
      speakText(askMsg);
      waitingForVideoRef.current = true;
      setWaitingForVideo(true);
      return;
    }

    if (lower.includes('open google')) {
      window.open('https://google.com', '_blank');
      const msg = 'Opening Google now.';
      setMessages(prev => [...prev,
        { role: 'user', text: transcript },
        { role: 'assistant', text: `⚡ SYSTEM: ${msg}` }
      ]);
      speakText(msg);
      return;
    }

    if (lower.includes('open github')) {
      window.open('https://github.com', '_blank');
      const msg = 'Opening GitHub now.';
      setMessages(prev => [...prev,
        { role: 'user', text: transcript },
        { role: 'assistant', text: `⚡ SYSTEM: ${msg}` }
      ]);
      speakText(msg);
      return;
    }

    try {
      const res = await fetch('http://localhost:5000/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: transcript }),
      });
      const data = await res.json();
      if (data.status !== 'not_a_command') {
        const systemMsg = data.speak || data.status;
        setMessages(prev => [...prev,
          { role: 'user', text: transcript },
          { role: 'assistant', text: `⚡ SYSTEM: ${systemMsg}` }
        ]);
        speakText(systemMsg);
        if (lower.startsWith('remember ') || lower.startsWith('nova remember ')) {
          fetchMemories();
        }
        return;
      }
    } catch {}

    await sendToGroq(transcript);
  }, [sendToGroq, speakText, fetchMemories]);

  // ── Continuous mic with VAD silence detection ──
  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition not supported. Please use Chrome or Edge.');
      return;
    }

    window.speechSynthesis.cancel();

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true; // ← KEY: enables VAD silence detection
    recognition.lang = 'en-IN';
    recognition.maxAlternatives = 1;

    const clearSilenceTimer = () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };

    const startSilenceTimer = (finalTranscript: string) => {
      clearSilenceTimer();
      // After SILENCE_DELAY ms of no new speech → fire command
      silenceTimerRef.current = setTimeout(() => {
        const text = finalTranscript.trim();
        if (text && !isSpeakingRef.current) {
          interimTranscriptRef.current = '';
          console.log('[NOVA VAD fired]', text);
          processVoiceCommand(text);
        }
      }, SILENCE_DELAY);
    };

    recognition.onresult = (event: any) => {
      if (isSpeakingRef.current) return; // ignore echo

      let finalText = '';
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      if (finalText) {
        // Accumulate final text
        interimTranscriptRef.current += ' ' + finalText;
        interimTranscriptRef.current = interimTranscriptRef.current.trim();
        // Reset silence timer — user may still be speaking
        startSilenceTimer(interimTranscriptRef.current);
      } else if (interimText) {
        // User is actively speaking — reset the timer
        clearSilenceTimer();
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return;
      if (event.error === 'aborted') return;
      console.error('[Voice Error]', event.error);
    };

    // Auto-restart only when not speaking
    recognition.onend = () => {
      if (listeningRef.current && !isSpeakingRef.current) {
        try { recognition.start(); } catch {}
      }
    };

    recognitionRef.current = recognition;
    listeningRef.current = true;
    setListening(true);

    try {
      recognition.start();
    } catch (e) {
      console.error('[Mic Start Error]', e);
      listeningRef.current = false;
      setListening(false);
    }
  }, [processVoiceCommand]);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    // Clear any pending silence timer
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    interimTranscriptRef.current = '';
    try {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    } catch {}
  }, []);

  const toggleListening = useCallback(() => {
    if (listeningRef.current) {
      stopListening();
    } else {
      startListening();
    }
  }, [startListening, stopListening]);

  // ── Handle Text Command ──
  const handleCommand = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || generating) return;
    setInputValue('');

    const lower = text.toLowerCase();

    if (lower.includes('open youtube')) {
      window.open('https://youtube.com', '_blank');
      setMessages(prev => [...prev,
        { role: 'user', text },
        { role: 'assistant', text: '⚡ SYSTEM: Opening YouTube now.' }
      ]);
      return;
    }

    if (lower.includes('play youtube') || lower.includes('play on youtube') || lower.includes('play music')) {
      const askMsg = 'Sure! What video or song would you like to play?';
      setMessages(prev => [...prev,
        { role: 'user', text },
        { role: 'assistant', text: `⚡ SYSTEM: ${askMsg}` }
      ]);
      waitingForVideoRef.current = true;
      setWaitingForVideo(true);
      return;
    }

    if (waitingForVideoRef.current) {
      waitingForVideoRef.current = false;
      setWaitingForVideo(false);
      const searchQuery = encodeURIComponent(text);
      window.open(`https://www.youtube.com/results?search_query=${searchQuery}`, '_blank');
      setMessages(prev => [...prev,
        { role: 'user', text },
        { role: 'assistant', text: `⚡ SYSTEM: Searching YouTube for "${text}"` }
      ]);
      return;
    }

    if (lower.startsWith('remember ') || lower.startsWith('nova remember ')) {
      try {
        const res = await fetch('http://localhost:5000/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: text }),
        });
        const data = await res.json();
        const systemMsg = data.speak || data.status;
        setMessages(prev => [...prev,
          { role: 'user', text },
          { role: 'assistant', text: `⚡ SYSTEM: ${systemMsg}` }
        ]);
        speakText(systemMsg);
        fetchMemories();
        return;
      } catch {}
    }

    await sendToGroq(text);
  }, [inputValue, generating, sendToGroq, speakText, fetchMemories]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCommand();
    }
  };

  const getStatus = () => {
    if (speaking) return '🔊 SPEAKING...';
    if (listening) return '🎙️ LISTENING...';
    if (generating) return 'PROCESSING...';
    if (waitingForVideo) return '🎵 WAITING FOR SONG...';
    return 'SECURE LINK: ACTIVE';
  };

  const getStatusColor = () => {
    if (speaking) return '#00ff88';
    if (listening) return '#ff3cac';
    if (generating) return '#ffaa00';
    if (waitingForVideo) return '#ff6b35';
    return '#00eaff';
  };

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    top: '75px',
    width: '300px',
    height: 'calc(100vh - 155px)',
    background: 'rgba(0, 10, 20, 0.6)',
    border: '1px solid #00eaff55',
    borderRadius: '8px',
    boxShadow: '0 0 20px rgba(0,234,255,0.15), inset 0 0 15px rgba(0,234,255,0.08)',
    padding: '16px',
    overflowY: 'auto',
    zIndex: 10,
    backdropFilter: 'blur(4px)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  };

  const panelTitleStyle: React.CSSProperties = {
    color: '#00ff88',
    fontSize: '0.85rem',
    textTransform: 'uppercase',
    letterSpacing: '3px',
    borderBottom: '1px solid #00eaff33',
    paddingBottom: '8px',
    margin: 0,
    flexShrink: 0,
  };

  return (
    <div className="nova-container">

      {/* ── TOP BAR ── */}
      <div className="top-left">
        NOVA INTERFACE v2.0
        <span style={{
          color: '#00ff88', marginLeft: '15px', fontSize: '0.75rem',
          border: '1px solid #00ff8844', padding: '2px 8px',
          borderRadius: '4px', textShadow: '0 0 5px #00ff88'
        }}>
          [CORE: GROQ ⚡]
        </span>
      </div>
      <div className="top-center">{time}</div>
      <div className="date-display">{date}</div>
      <div className="top-right" style={{ color: getStatusColor() }}>
        {getStatus()}
      </div>

      {/* ── ORB ── */}
      <div className="orb-ring"></div>
      <div className="glow-circle" style={{
        boxShadow: speaking
          ? '0 0 60px rgba(0,255,136,0.9), 0 0 100px rgba(0,255,136,0.5)'
          : listening
          ? '0 0 60px rgba(255,60,172,0.9), 0 0 100px rgba(255,60,172,0.5)'
          : waitingForVideo
          ? '0 0 60px rgba(255,107,53,0.9), 0 0 100px rgba(255,107,53,0.5)'
          : '0 0 50px rgba(0,234,255,0.8), 0 0 80px rgba(0,234,255,0.4)'
      }}></div>

      {/* ── LEFT PANEL — MEMORY CORE ── */}
      <div style={{ ...panelStyle, left: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h3 style={panelTitleStyle}>🧠 MEMORY CORE</h3>
          {memories.length > 0 && (
            <button onClick={clearAllMemories} style={{
              background: 'transparent', border: '1px solid #ff3cac44',
              borderRadius: '4px', color: '#ff3cac88', fontSize: '0.65rem',
              padding: '2px 7px', cursor: 'pointer', letterSpacing: '1px',
              fontFamily: 'Orbitron, sans-serif',
            }}>CLEAR ALL</button>
          )}
        </div>

        <div style={{ fontSize: '0.68rem', color: '#00eaff66', borderLeft: '2px solid #00eaff33', paddingLeft: '8px', flexShrink: 0 }}>
          {memories.length} / 50 memories stored
        </div>

        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <input
            value={newMemory}
            onChange={e => setNewMemory(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addMemory()}
            placeholder="Store a memory..."
            style={{
              flex: 1, padding: '8px 10px',
              background: 'rgba(0,0,0,0.6)', border: '1px solid #00eaff33',
              borderRadius: '4px', color: '#00eaff',
              fontFamily: 'Orbitron, sans-serif', fontSize: '0.68rem', outline: 'none',
            }}
          />
          <button onClick={addMemory} style={{
            padding: '8px 12px', background: 'rgba(0,234,255,0.08)',
            border: '1px solid #00eaff44', borderRadius: '4px',
            color: '#00eaff', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold',
          }}>+</button>
        </div>

        <div style={{ fontSize: '0.62rem', color: '#00ff8855', borderLeft: '2px solid #00ff8833', paddingLeft: '8px', lineHeight: 1.5, flexShrink: 0 }}>
          💡 Say "Remember..." to save by voice
        </div>

        {memories.length === 0 ? (
          <div style={{ color: '#00eaff33', fontSize: '0.72rem', textAlign: 'center', marginTop: '20px', lineHeight: 1.8 }}>
            No memories yet.<br />Type above or say<br />"Remember I prefer..."
          </div>
        ) : (
          memories.map(mem => (
            <div key={mem.id} style={{
              background: 'rgba(0,234,255,0.04)', border: '1px solid #00eaff1a',
              borderRadius: '6px', padding: '10px 12px',
              display: 'flex', flexDirection: 'column', gap: '5px', flexShrink: 0,
            }}>
              <div style={{ color: '#00eaff', fontSize: '0.75rem', lineHeight: 1.55 }}>
                {mem.text}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#00ff8855', fontSize: '0.62rem' }}>{mem.timestamp}</span>
                <button onClick={() => deleteMemory(mem.id)} style={{
                  background: 'transparent', border: 'none',
                  color: '#ff3cac66', cursor: 'pointer', fontSize: '0.7rem', padding: '1px 5px',
                }}>✕</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── RIGHT PANEL — SYSTEM LOG ── */}
      <div
        className={`right-panel ${speaking ? 'speaking' : listening ? 'listening' : ''}`}
        ref={rightPanelRef}
      >
        <h3>SYSTEM LOG</h3>
        {messages.map((msg, idx) => (
          <div key={idx} className={
            msg.role === 'user' ? 'user-message' :
            msg.text.startsWith('⚡') ? 'system-message' : 'ai-message'
          }>
            {msg.role === 'user' ? `> USER: ${msg.text}` : msg.text}
          </div>
        ))}
      </div>

      {/* ── AUDIO BARS ── */}
      <div className="audio-bars">
        {[1,2,3,4,5].map(i => (
          <div key={i} className="bar" style={{
            animationPlayState: listening || speaking ? 'running' : 'paused',
            background: speaking ? '#00ff88' : listening ? '#ff3cac' : '#00eaff'
          }}></div>
        ))}
      </div>

      {/* ── COMMAND CENTER ── */}
      <div className="command-center">
        <div className="input-row">
          <textarea
            className="command-input"
            placeholder={
              speaking ? "🔊 NOVA SPEAKING..." :
              listening ? "🎙️ LISTENING... (press mic to stop)" :
              waitingForVideo ? "🎵 SAY THE SONG NAME..." :
              generating ? "PROCESSING..." :
              "ENTER COMMAND..."
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={generating}
            autoFocus
            rows={1}
          />
          <button
            className={`mic-btn ${listening ? 'mic-active' : ''}`}
            onClick={toggleListening}
            title={listening ? "Click to stop listening" : "Click to start listening"}
          >
            {listening ? '🔴' : '🎙️'}
          </button>
        </div>
      </div>

    </div>
  );
}
