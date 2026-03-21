import React, { useState, useEffect, useRef, useCallback } from 'react';
import '../styles/NovaTheme.css';

interface Message {
  role: 'user' | 'assistant';
  text: string;
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

  const cancelRef = useRef<AbortController | null>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const waitingForVideoRef = useRef(false);
  const listeningRef = useRef(false);

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

  // ── Speak Response (Neerja - Indian Neural Voice) ──
  const speakText = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const trySpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1;

      // Neerja first, then fallbacks
      const preferred =
        voices.find(v => v.name.includes('Neerja')) ||
        voices.find(v => v.name.includes('Online') && v.lang === 'en-IN') ||
        voices.find(v => v.lang === 'en-IN') ||
        voices.find(v => v.name.includes('Online') && v.lang.startsWith('en'));

      if (preferred) {
        utterance.voice = preferred;
        utterance.lang = preferred.lang;
        console.log('[NOVA Voice Selected]', preferred.name, preferred.lang);
      } else {
        utterance.lang = 'en-IN';
        console.log('[NOVA Voice] Using default voice');
      }

      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);

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
              content: 'You are NOVA, an advanced AI assistant with a sleek futuristic personality. Be helpful, concise, and slightly futuristic in tone. Keep responses short and punchy unless asked for detail.'
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
  }, [messages, speakText]);

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
        return;
      }
    } catch {
      // Flask not running — skip
    }

    await sendToGroq(transcript);
  }, [sendToGroq, speakText]);

  // ── Create fresh recognition instance ──
  const createRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-IN';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      console.log('[NOVA Voice]', transcript);
      listeningRef.current = false;
      setListening(false);
      processVoiceCommand(transcript);
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return;
      if (event.error === 'aborted') return;
      console.error('[Voice Error]', event.error);
      listeningRef.current = false;
      setListening(false);
    };

    recognition.onend = () => {
      listeningRef.current = false;
      setListening(false);
    };

    return recognition;
  }, [processVoiceCommand]);

  // ── Mic Toggle ──
  const toggleListening = useCallback(() => {
    if (listeningRef.current) {
      listeningRef.current = false;
      setListening(false);
      try {
        if ((window as any)._novaRecognition) {
          (window as any)._novaRecognition.stop();
        }
      } catch {}
    } else {
      window.speechSynthesis.cancel();
      const recognition = createRecognition();
      if (!recognition) return;

      (window as any)._novaRecognition = recognition;
      listeningRef.current = true;
      setListening(true);

      try {
        recognition.start();
      } catch (e) {
        console.error('[Mic Error]', e);
        listeningRef.current = false;
        setListening(false);
      }
    }
  }, [createRecognition]);

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

    await sendToGroq(text);
  }, [inputValue, generating, sendToGroq]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCommand();
    }
  };

  const getStatus = () => {
    if (listening) return '🎙️ LISTENING...';
    if (speaking) return '🔊 SPEAKING...';
    if (generating) return 'PROCESSING...';
    if (waitingForVideo) return '🎵 WAITING FOR SONG...';
    return 'SECURE LINK: ACTIVE';
  };

  const getStatusColor = () => {
    if (listening) return '#ff3cac';
    if (speaking) return '#00ff88';
    if (generating) return '#ffaa00';
    if (waitingForVideo) return '#ff6b35';
    return '#00eaff';
  };

  return (
    <div className="nova-container">
      <div className="top-left">
        NOVA INTERFACE v2.0
        <span style={{
          color: '#00ff88',
          marginLeft: '15px',
          fontSize: '0.75rem',
          border: '1px solid #00ff8844',
          padding: '2px 8px',
          borderRadius: '4px',
          textShadow: '0 0 5px #00ff88'
        }}>
          [CORE: GROQ ⚡]
        </span>
      </div>

      <div className="top-center">{time}</div>
      <div className="date-display">{date}</div>
      <div className="top-right" style={{ color: getStatusColor() }}>
        {getStatus()}
      </div>

      <div className="orb-ring"></div>

      <div className="glow-circle" style={{
        boxShadow: listening
          ? '0 0 60px rgba(255,60,172,0.9), 0 0 100px rgba(255,60,172,0.5)'
          : speaking
          ? '0 0 60px rgba(0,255,136,0.9), 0 0 100px rgba(0,255,136,0.5)'
          : waitingForVideo
          ? '0 0 60px rgba(255,107,53,0.9), 0 0 100px rgba(255,107,53,0.5)'
          : '0 0 50px rgba(0,234,255,0.8), 0 0 80px rgba(0,234,255,0.4)'
      }}></div>

      <div
        className={`right-panel ${listening ? 'listening' : speaking ? 'speaking' : ''}`}
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

      <div className="audio-bars">
        {[1,2,3,4,5].map(i => (
          <div key={i} className="bar" style={{
            animationPlayState: listening || speaking ? 'running' : 'paused',
            background: listening ? '#ff3cac' : speaking ? '#00ff88' : '#00eaff'
          }}></div>
        ))}
      </div>

      <div className="command-center">
        <div className="input-row">
          <textarea
            className="command-input"
            placeholder={
              listening ? "🎙️ LISTENING..." :
              waitingForVideo ? "🎵 SAY THE SONG NAME..." :
              generating ? "PROCESSING..." :
              "ENTER COMMAND..."
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={generating || listening}
            autoFocus
            rows={1}
          />
          <button
            className={`mic-btn ${listening ? 'mic-active' : ''}`}
            onClick={toggleListening}
            title={listening ? "Click to stop" : "Click to speak"}
          >
            {listening ? '🔴' : '🎙️'}
          </button>
        </div>
      </div>
    </div>
  );
}