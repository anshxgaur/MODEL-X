import React, {
  useState, useEffect, useRef, useCallback, KeyboardEvent,
} from 'react';
import '../styles/NovaTheme.css';

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  streaming?: boolean;
}

interface Memory {
  id: string;
  text: string;
  timestamp: string;
}

interface Conversation {
  id: string;
  label: string;
  messages: Message[];
}

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

/* ═══════════════════════════════════════════════════════════════
   PARTICLE SPHERE CANVAS
   Inspired by Perplexity's voice assistant orb
   ═══════════════════════════════════════════════════════════════ */
interface Particle {
  theta: number; // azimuthal angle
  phi: number;   // polar angle
  r: number;     // base radius
  speed: number;
  size: number;
  opacity: number;
  color: string;
}

function ParticleSphere({
  voiceState,
  audioLevel = 0,
}: {
  voiceState: VoiceState;
  audioLevel?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const timeRef = useRef(0);

  /* Build particles once */
  useEffect(() => {
    const N = 280;
    const particles: Particle[] = [];

    // Colors: white with hints of teal
    const colors = [
      'rgba(255,255,255,',
      'rgba(200,255,245,',
      'rgba(180,240,235,',
    ];

    for (let i = 0; i < N; i++) {
      // Golden-ratio spherical distribution for even spread
      const phi = Math.acos(1 - (2 * (i + 0.5)) / N);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      particles.push({
        theta,
        phi,
        r: 1,
        speed: 0.0003 + Math.random() * 0.0004,
        size: Math.random() < 0.15 ? 2.5 : Math.random() < 0.5 ? 1.8 : 1.2,
        opacity: 0.4 + Math.random() * 0.6,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    particlesRef.current = particles;
  }, []);

  /* Animation loop — with heartbeat pulse + EKG waveform */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const dpr = window.devicePixelRatio || 1;
    const ORB_SIZE = 300;
    const WAVE_H   = 72;          // waveform band height below orb
    const W = ORB_SIZE;
    const H = ORB_SIZE + WAVE_H;

    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    const cx = W / 2;
    const cy = ORB_SIZE / 2;

    /* State config — calm, Perplexity-style values */
    const stateConfig: Record<VoiceState, { radius: number; rotSpeed: number; scatter: number }> = {
      idle:       { radius: 104, rotSpeed: 0.10, scatter: 0 },
      listening:  { radius: 112, rotSpeed: 0.22, scatter: 3 },
      processing: { radius: 100, rotSpeed: 0.16, scatter: 2 },
      speaking:   { radius: 110, rotSpeed: 0.20, scatter: 2 },
    };

    let currentRadius   = 105;
    let currentRotSpeed = 0.18;

    /* ── Smooth pulse state ─────────────────────────────────────────
       Low sensitivity, slow decay → gentle breathing, not jarring  */
    let pulseEnergy  = 0;
    let smoothAudio  = 0;         // exponential moving average of raw audioLevel
    let prevSmooth   = 0;
    const SMOOTH_K     = 0.08;   // EMA coefficient — lower = smoother audio
    const PULSE_THRESH = 0.28;   // only trigger on real speech peaks, not mic noise
    const PULSE_DECAY  = 0.955;  // very slow decay — long, graceful tail
    const PULSE_MAX    = 10;     // subtle expansion (was 26)

    /* ── Waveform ring buffer ── */
    const WAVE_LEN   = 180;      // wider history = calmer-looking waveform
    const waveBuffer = new Float32Array(WAVE_LEN);
    let   waveHead   = 0;
    let   smoothWave = 0;        // smoothed value written to waveBuffer

    function draw(ts: number) {
      timeRef.current = ts;
      const cfg = stateConfig[voiceState];

      /* ── Smooth the raw audio level with an EMA to kill mic jitter ── */
      smoothAudio = smoothAudio + SMOOTH_K * (audioLevel - smoothAudio);

      /* ── Detect smooth pulse peak (rising edge on smoothed signal) ── */
      const delta = smoothAudio - prevSmooth;
      if (delta > PULSE_THRESH && smoothAudio > 0.22) {
        pulseEnergy = Math.min(pulseEnergy + delta * 1.4, 1.0);
      }
      prevSmooth = smoothAudio;

      /* Very slow exponential decay → long, calming tail */
      pulseEnergy *= PULSE_DECAY;

      /* Smooth the waveform value too before pushing to buffer */
      smoothWave = smoothWave + 0.12 * (smoothAudio - smoothWave);
      waveBuffer[waveHead] = smoothWave;
      waveHead = (waveHead + 1) % WAVE_LEN;

      /* Ultra-smooth lerps — radius and rotation change glacially */
      const targetR = cfg.radius + smoothAudio * 7 + pulseEnergy * PULSE_MAX;
      currentRadius   += (targetR       - currentRadius)   * 0.028;  // very slow
      currentRotSpeed += (cfg.rotSpeed  - currentRotSpeed) * 0.018;  // very slow

      /* Clear entire canvas */
      ctx.clearRect(0, 0, W, H);

      /* ── Ambient glow — very subtle, breathes with pulse ── */
      const glowA = voiceState === 'idle'
        ? 0.04
        : 0.05 + pulseEnergy * 0.10;   // barely changes, no flash
      const glowColor = voiceState === 'speaking'
        ? `rgba(59,130,246,${glowA.toFixed(2)})`
        : `rgba(34,197,94,${glowA.toFixed(2)})`;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 145);
      g.addColorStop(0, glowColor);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, ORB_SIZE);

      /* ── Particles ── */
      const angle = ts * currentRotSpeed * 0.001;

      const projected = particlesRef.current.map((p, i) => {
        const theta   = p.theta + angle * p.speed * 1800;
        const phi     = p.phi;
        const sinPhi  = Math.sin(phi);
        const cosPhi  = Math.cos(phi);
        const sinTheta= Math.sin(theta);
        const cosTheta= Math.cos(theta);

        /* Gentle breathing scatter — very low frequency, low amplitude */
        const scatter = cfg.scatter * Math.sin(ts * 0.0003 * p.speed * 5);

        /* Soft uniform breath on pulse — no per-particle ripple jitter */
        const breath = pulseEnergy * PULSE_MAX * 0.6;

        const r = currentRadius + scatter * p.r + breath;

        const x3 = r * sinPhi * cosTheta;
        const y3 = r * cosPhi;
        const z3 = r * sinPhi * sinTheta;

        const persp  = 1 + z3 / 800;
        const px     = cx + x3 / persp;
        const py     = cy + y3 / persp;
        const depth  = (z3 + currentRadius) / (2 * currentRadius);

        /* Very subtle brightness lift on beat */
        const burst  = pulseEnergy * 0.12;
        const opacity= Math.min((0.25 + depth * 0.75) * p.opacity + burst, 1);
        const size   = p.size * (0.5 + depth * 0.7) * (1 + pulseEnergy * 0.10);

        return { px, py, z3, opacity, size, color: p.color };
      });

      projected.sort((a, b) => a.z3 - b.z3);

      for (const pt of projected) {
        ctx.beginPath();
        ctx.arc(pt.px, pt.py, pt.size, 0, Math.PI * 2);
        ctx.fillStyle = pt.color + pt.opacity.toFixed(2) + ')';
        ctx.fill();
      }

      /* ══════════════════════════════════════════════════
         EKG / HEARTBEAT WAVEFORM  (below the sphere)
         ══════════════════════════════════════════════════ */
      const waveY   = ORB_SIZE + WAVE_H / 2;   // baseline
      const waveAmp = WAVE_H * 0.36;

      /* Baseline rule */
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth   = 0.8;
      ctx.moveTo(0, waveY);
      ctx.lineTo(W, waveY);
      ctx.stroke();

      /* Waveform color — fixed teal, subtle opacity shift only */
      const wOpacity = voiceState === 'idle' ? 0.28 : 0.50 + pulseEnergy * 0.15;
      const waveStroke = voiceState === 'speaking'
        ? `rgba(96,165,250,${wOpacity.toFixed(2)})`   // soft blue when speaking
        : `rgba(52,211,153,${wOpacity.toFixed(2)})`;   // teal when listening

      /* ── Smooth Bézier waveform (no jagged lineTo) ── */
      ctx.beginPath();
      ctx.strokeStyle = waveStroke;
      ctx.lineWidth   = 1.6;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      /* Gentle glow — only if there's meaningful audio */
      ctx.shadowColor = voiceState === 'speaking' ? 'rgba(96,165,250,0.4)' : 'rgba(52,211,153,0.4)';
      ctx.shadowBlur  = pulseEnergy > 0.1 ? 6 : 0;

      /* Build smooth curve: gather (x,y) points first */
      const pts: [number, number][] = [];
      for (let i = 0; i < WAVE_LEN; i++) {
        const idx = (waveHead + i) % WAVE_LEN;
        const val = waveBuffer[idx];
        const x   = (i / (WAVE_LEN - 1)) * W;
        /* Soft sinusoidal shaping — no harsh exponential spike */
        const yOff = waveAmp * Math.sin(val * Math.PI * 0.5) * val;
        pts.push([x, waveY - yOff]);
      }

      /* Catmull-Rom → quadratic Bézier approximation for silky smoothness */
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);

      ctx.stroke();
      ctx.shadowBlur = 0;

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [voiceState, audioLevel]);

  return <canvas ref={canvasRef} className="particle-canvas" />;
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */
const uid = () => crypto.randomUUID();

const SUGGESTIONS = [
  { icon: '🌤️', title: "What's the weather today?", sub: 'Get real-time info' },
  { icon: '🎵', title: 'Play some music on Spotify', sub: 'Control your media' },
  { icon: '💡', title: 'Help me focus for 30 mins', sub: 'Start a work session' },
  { icon: '🖥️', title: "What's running on my PC?", sub: 'System overview' },
];

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export function NovaInterface() {
  /* ── State ── */
  const [conversations, setConversations] = useState<Conversation[]>([
    { id: uid(), label: 'New conversation', messages: [] },
  ]);
  const [activeId, setActiveId] = useState<string>(conversations[0].id);
  const [inputValue, setInputValue] = useState('');
  const [generating, setGenerating] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [newMemory, setNewMemory] = useState('');
  const [time, setTime] = useState('');
  const [backendStatus, setBackendStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [searchQuery, setSearchQuery] = useState('');

  // Voice assistant overlay
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceResponse, setVoiceResponse] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);

  /* ── Refs ── */
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const cancelRef = useRef<AbortController | null>(null);
  const isSpeakingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioRafRef = useRef<number>(0);

  /* ── Derived ── */
  const activeConv = conversations.find(c => c.id === activeId)!;
  const messages = activeConv?.messages ?? [];
  const filteredConvs = conversations.filter(c =>
    c.label.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  /* ── Clock ── */
  useEffect(() => {
    const tick = () =>
      setTime(new Date().toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  /* ── Backend health ── */
  useEffect(() => {
    fetch('http://localhost:5000/api/memory', { signal: AbortSignal.timeout(3000) })
      .then(r => setBackendStatus(r.ok ? 'online' : 'offline'))
      .catch(() => setBackendStatus('offline'));
  }, []);

  /* ── Memories (localStorage) ── */
  useEffect(() => {
    const s = localStorage.getItem('nova_memories_v2');
    if (s) setMemories(JSON.parse(s));
  }, []);

  const saveMemories = (mems: Memory[]) => {
    localStorage.setItem('nova_memories_v2', JSON.stringify(mems));
    setMemories(mems);
  };

  /* ── Auto scroll ── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* ── Auto-resize textarea ── */
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [inputValue]);

  /* ── Conversation helpers ── */
  const patchMessages = useCallback((convId: string, fn: (msgs: Message[]) => Message[]) => {
    setConversations(prev =>
      prev.map(c => c.id === convId ? { ...c, messages: fn(c.messages) } : c),
    );
  }, []);

  const updateConvLabel = useCallback((convId: string, label: string) => {
    setConversations(prev =>
      prev.map(c => c.id === convId ? { ...c, label } : c),
    );
  }, []);

  /* ── Memory CRUD ── */
  const addMemory = useCallback(() => {
    const text = newMemory.trim();
    if (!text) return;
    const m: Memory = { id: uid(), text, timestamp: new Date().toLocaleString('en-IN') };
    saveMemories([m, ...memories].slice(0, 50));
    setNewMemory('');
  }, [newMemory, memories]);

  const deleteMemory = useCallback((id: string) => {
    saveMemories(memories.filter(m => m.id !== id));
  }, [memories]);

  /* ── New conversation ── */
  const newConversation = useCallback(() => {
    const conv: Conversation = { id: uid(), label: 'New conversation', messages: [] };
    setConversations(prev => [conv, ...prev]);
    setActiveId(conv.id);
    setInputValue('');
  }, []);

  /* ════════════════════════════════════════════════════════════════
     CHAT SEND (text)
     ════════════════════════════════════════════════════════════════ */
  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? inputValue).trim();
    if (!text || generating) return;

    setGenerating(true);
    setInputValue('');

    const convId = activeId;
    const userMsgId = uid();
    const asstMsgId = uid();

    if (messages.length === 0) {
      updateConvLabel(convId, text.slice(0, 40) + (text.length > 40 ? '…' : ''));
    }

    patchMessages(convId, msgs => [
      ...msgs,
      { id: userMsgId, role: 'user', text },
      { id: asstMsgId, role: 'assistant', text: '', streaming: true },
    ]);

    const controller = new AbortController();
    cancelRef.current = controller;

    try {
      // Step 1: command endpoint
      const cmdRes = await fetch('http://localhost:5000/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: text }),
        signal: controller.signal,
      }).catch(() => null);

      if (cmdRes?.ok) {
        const cmdData = await cmdRes.json();
        if (cmdData.status !== 'not_a_command') {
          patchMessages(convId, msgs =>
            msgs.map(m => m.id === asstMsgId
              ? { ...m, text: cmdData.speak || cmdData.status, streaming: false }
              : m),
          );
          return;
        }
      }

      // Step 2: LLM streaming
      const prevMsgs = messages.map(m => ({ role: m.role, content: m.text }));
      const chatRes = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [...prevMsgs, { role: 'user', content: text }],
        }),
      });

      if (!chatRes.ok) throw new Error(`Backend error ${chatRes.status}`);

      const reader = chatRes.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        patchMessages(convId, msgs =>
          msgs.map(m => m.id === asstMsgId ? { ...m, text: accumulated } : m),
        );
      }

      patchMessages(convId, msgs =>
        msgs.map(m => m.id === asstMsgId ? { ...m, streaming: false } : m),
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const errMsg = err instanceof Error ? err.message : String(err);
      patchMessages(convId, msgs =>
        msgs.map(m => m.id === asstMsgId
          ? { ...m, text: `Unable to reach NOVA backend. ${errMsg}`, streaming: false }
          : m),
      );
    } finally {
      cancelRef.current = null;
      setGenerating(false);
    }
  }, [inputValue, generating, activeId, messages, patchMessages, updateConvLabel]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  /* ════════════════════════════════════════════════════════════════
     VOICE ASSISTANT — Audio level meter via Web Audio API
     ════════════════════════════════════════════════════════════════ */
  const startAudioMeter = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      function measure() {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setAudioLevel(avg / 128); // normalize 0..1ish
        audioRafRef.current = requestAnimationFrame(measure);
      }
      audioRafRef.current = requestAnimationFrame(measure);
    } catch {
      // No mic access, continue without level
    }
  };

  const stopAudioMeter = () => {
    cancelAnimationFrame(audioRafRef.current);
    setAudioLevel(0);
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
  };

  /* ════════════════════════════════════════════════════════════════
     VOICE ASSISTANT — Speech + Backend
     ════════════════════════════════════════════════════════════════ */
  const cleanForTTS = (text: string) =>
    text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1')
      .replace(/`.*?`/g, '').replace(/#{1,6}\s/g, '').replace(/\n/g, ' ').trim();

  const speakText = useCallback((text: string, onEnd?: () => void) => {
    if (!window.speechSynthesis) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(cleanForTTS(text));
    u.lang = 'en-IN';
    u.rate = 1.05;
    u.pitch = 1.0;
    u.onstart = () => { isSpeakingRef.current = true; };
    u.onend = () => { isSpeakingRef.current = false; onEnd?.(); };
    u.onerror = () => { isSpeakingRef.current = false; onEnd?.(); };
    window.speechSynthesis.speak(u);
  }, []);

  const processVoiceInput = useCallback(async (text: string) => {
    if (!text.trim() || isProcessingRef.current) return;

    isProcessingRef.current = true;
    setVoiceTranscript(text);
    setVoiceState('processing');
    setVoiceResponse('');

    try {
      // Try command first
      const cmdRes = await fetch('http://localhost:5000/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: text }),
      }).catch(() => null);

      if (cmdRes?.ok) {
        const cmdData = await cmdRes.json();
        if (cmdData.status !== 'not_a_command') {
          const reply = cmdData.speak || cmdData.status;
          setVoiceResponse(reply);
          setVoiceState('speaking');
          speakText(reply, () => {
            setVoiceState('listening');
            isProcessingRef.current = false;
            startVoiceListenContinuous();
          });
          return;
        }
      }

      // LLM chat with streaming
      const chatRes = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }],
        }),
      });

      if (!chatRes.ok) throw new Error();

      const reader = chatRes.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setVoiceResponse(accumulated);
      }

      setVoiceState('speaking');
      speakText(accumulated, () => {
        setVoiceState('listening');
        isProcessingRef.current = false;
        startVoiceListenContinuous();
      });
    } catch {
      setVoiceState('idle');
      isProcessingRef.current = false;
    }
  }, [speakText]);

  // Forward declaration so we can reference it in the callback above
  const startVoiceListenContinuousRef = useRef<() => void>(() => {});

  const startVoiceListenContinuous = useCallback(() => {
    startVoiceListenContinuousRef.current();
  }, []);

  useEffect(() => {
    startVoiceListenContinuousRef.current = () => {
      if (!voiceOpen) return;

      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) return;

      const rec = new SR();
      rec.lang = 'en-IN';
      rec.continuous = false;
      rec.interimResults = false;

      rec.onstart = () => setVoiceState('listening');

      rec.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        processVoiceInput(text);
      };

      rec.onerror = (e: any) => {
        if (e.error !== 'aborted') setVoiceState('idle');
      };

      rec.onend = () => {
        // Don't auto-restart; processVoiceInput will restart after speaking
        if (!isProcessingRef.current && !isSpeakingRef.current && voiceOpen) {
          setVoiceState('idle');
        }
      };

      recognitionRef.current = rec;
      try { rec.start(); } catch {}
    };
  }, [voiceOpen, processVoiceInput]);

  /* ── Open voice assistant ── */
  const openVoice = useCallback(async () => {
    setVoiceOpen(true);
    setVoiceTranscript('');
    setVoiceResponse('');
    setVoiceState('listening');
    isProcessingRef.current = false;
    isSpeakingRef.current = false;
    await startAudioMeter();
    setTimeout(() => startVoiceListenContinuousRef.current(), 100);
  }, []);

  /* ── Close voice assistant ── */
  const closeVoice = useCallback(() => {
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
    stopAudioMeter();
    setVoiceOpen(false);
    setVoiceState('idle');
    setVoiceTranscript('');
    setVoiceResponse('');
    isProcessingRef.current = false;
    isSpeakingRef.current = false;
  }, []);

  /* ── Toggle mic inside overlay ── */
  const toggleVoiceMic = useCallback(() => {
    if (voiceState === 'listening') {
      recognitionRef.current?.stop();
      setVoiceState('idle');
    } else if (voiceState === 'idle') {
      startVoiceListenContinuousRef.current();
    }
  }, [voiceState]);

  /* ── Copy ── */
  const copyMsg = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  /* ══════════════════════════════════════════════════════════════
     VOICE STATE LABELS
     ══════════════════════════════════════════════════════════════ */
  const voiceStateLabel: Record<VoiceState, string> = {
    idle: 'Tap the mic to speak',
    listening: 'Listening…',
    processing: 'Thinking…',
    speaking: 'Speaking…',
  };

  /* ══════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════ */
  return (
    <div className="nova-shell">

      {/* ═════ SIDEBAR ═════ */}
      <aside className="nova-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">⚡</div>
            <span className="sidebar-logo-text">NOVA</span>
          </div>
          <button className="new-chat-btn" onClick={newConversation} title="New chat">✏️</button>
        </div>

        <div className="sidebar-search">
          <div className="sidebar-search-inner">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            <input
              className="sidebar-search-input"
              placeholder="Search conversations"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="sidebar-section-label">Recents</div>
        <div className="sidebar-history">
          {filteredConvs.map(conv => (
            <div
              key={conv.id}
              className={`history-item ${conv.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(conv.id)}
            >
              <span className="history-item-icon">💬</span>
              <span className="history-item-label">{conv.label}</span>
            </div>
          ))}
        </div>

        {/* Memory */}
        <div className="memory-panel">
          <div className="memory-panel-header">
            <span className="memory-panel-title">Memories</span>
            {memories.length > 0 && (
              <button className="memory-clear-btn" onClick={() => saveMemories([])}>Clear all</button>
            )}
          </div>
          <div className="memory-add-row">
            <input
              className="memory-input"
              placeholder="Add a memory…"
              value={newMemory}
              onChange={e => setNewMemory(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addMemory()}
            />
            <button className="memory-add-btn" onClick={addMemory}>+</button>
          </div>
          <div className="memory-list">
            {memories.map(m => (
              <div key={m.id} className="memory-chip">
                <span className="memory-chip-text">{m.text}</span>
                <button className="memory-chip-del" onClick={() => deleteMemory(m.id)}>✕</button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-status">
          <div className={`status-dot ${backendStatus === 'online' ? '' : backendStatus === 'offline' ? 'red' : 'amber'}`} />
          <span>
            {backendStatus === 'online' ? 'Backend connected' :
              backendStatus === 'offline' ? 'Backend offline' : 'Connecting…'}
          </span>
        </div>
      </aside>

      {/* ═════ MAIN ═════ */}
      <main className="nova-main">

        {/* Top bar */}
        <div className="topbar">
          <div className="topbar-left">
            <div className="model-selector">
              <div className="model-selector-icon" />
              <span>NOVA AI</span>
              <span className="model-selector-chevron">▾</span>
            </div>
          </div>
          <div className="topbar-right">
            <div className="topbar-badge">
              <span style={{ fontSize: 10 }}>⚡</span>
              <span>Groq · Llama 3.3</span>
            </div>
            <div className="topbar-time">{time}</div>
          </div>
        </div>

        {/* Chat area */}
        <div className="chat-area">
          {messages.length === 0 ? (
            <div className="welcome-screen">
              <div className="welcome-logo">⚡</div>
              <h1 className="welcome-title">How can I help?</h1>
              <p className="welcome-subtitle">
                I'm NOVA — your personal AI. Ask me anything, control your computer,
                manage music, set reminders, and more.
              </p>
              <div className="welcome-suggestions">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="suggestion-card" onClick={() => send(s.title)}>
                    <span className="suggestion-card-icon">{s.icon}</span>
                    <span className="suggestion-card-title">{s.title}</span>
                    <span className="suggestion-card-sub">{s.sub}</span>
                  </button>
                ))}
              </div>

              {/* Big voice button on welcome */}
              <button className="welcome-voice-btn" onClick={openVoice}>
                <span className="welcome-voice-icon">🎙️</span>
                <span>Start voice conversation</span>
              </button>
            </div>
          ) : (
            <div className="messages-container">
              {messages.map(msg => (
                <MessageRow key={msg.id} msg={msg} onCopy={copyMsg} />
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="input-area">
          <div className="input-wrapper">
            <div className="input-box">
              <textarea
                ref={textareaRef}
                className="input-textarea"
                placeholder="Message NOVA…"
                rows={1}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={generating}
              />
              <div className="input-toolbar">
                <button className="input-tool-btn" onClick={openVoice} title="Voice mode">
                  🎙️ Voice
                </button>
                <div className="input-spacer" />
                {generating ? (
                  <button
                    className="send-btn"
                    onClick={() => { cancelRef.current?.abort(); setGenerating(false); }}
                  >⏹</button>
                ) : (
                  <button className="send-btn" onClick={() => send()} disabled={!inputValue.trim()}>↑</button>
                )}
              </div>
            </div>
            <p className="input-hint">NOVA can make mistakes. Verify important info.</p>
          </div>
        </div>
      </main>

      {/* ═════════════════════════════════════════════════════════════
          PERPLEXITY-STYLE VOICE OVERLAY
          ═════════════════════════════════════════════════════════════ */}
      {voiceOpen && (
        <div className="va-overlay">
          {/* Close */}
          <button className="va-close" onClick={closeVoice} title="Close">✕</button>

          {/* Particle sphere + state */}
          <div className="va-orb-section">
            <ParticleSphere voiceState={voiceState} audioLevel={audioLevel} />
          </div>

          {/* Text area */}
          <div className="va-text-section">
            {voiceTranscript ? (
              <p className="va-transcript">{voiceTranscript}</p>
            ) : (
              <p className="va-prompt-hint">Say something…</p>
            )}

            {voiceResponse && (
              <p className="va-response">{voiceResponse}</p>
            )}
          </div>

          {/* Controls */}
          <div className="va-controls">
            <button
              className={`va-mic-btn ${voiceState === 'listening' ? 'active' : ''}`}
              onClick={toggleVoiceMic}
              disabled={voiceState === 'processing' || voiceState === 'speaking'}
              title={voiceState === 'listening' ? 'Stop listening' : 'Start listening'}
            >
              {voiceState === 'listening' ? (
                <span className="va-mic-icon">⏹</span>
              ) : voiceState === 'processing' ? (
                <span className="va-processing-icon">⋯</span>
              ) : voiceState === 'speaking' ? (
                <span className="va-mic-icon">🔊</span>
              ) : (
                <span className="va-mic-icon">🎙️</span>
              )}
            </button>
          </div>

          {/* State label */}
          <p className="va-state-label">{voiceStateLabel[voiceState]}</p>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MESSAGE ROW
   ═══════════════════════════════════════════════════════════════ */
function MessageRow({ msg, onCopy }: { msg: Message; onCopy: (t: string) => void }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  return (
    <div className={`message-row${isSystem ? ' system' : ''}`}>
      <div className={`message-avatar ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? '👤' : isSystem ? '⚙️' : '⚡'}
      </div>
      <div className="message-body">
        <div className="message-role">
          {isUser ? 'You' : isSystem ? 'System' : 'NOVA'}
        </div>
        {msg.text === '' && msg.streaming ? (
          <div className="typing-indicator">
            <div className="typing-dot" />
            <div className="typing-dot" />
            <div className="typing-dot" />
          </div>
        ) : (
          <div className={`message-text${msg.streaming ? ' streaming' : ''}`}>
            {msg.text}
          </div>
        )}
        {!msg.streaming && msg.text && (
          <div className="message-actions">
            <button className="msg-action-btn" onClick={() => onCopy(msg.text)}>
              📋 Copy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}