import React, {
  useState, useEffect, useRef, useCallback, KeyboardEvent,
} from 'react';
import '../styles/NovaTheme.css';

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */
interface Message  { id:string; role:'user'|'assistant'|'system'; text:string; streaming?:boolean; }
interface Memory   { id:string; text:string; timestamp:string; }
interface Conversation { id:string; label:string; messages:Message[]; }
type VoiceState = 'idle'|'listening'|'processing'|'speaking';

/* ═══════════════════════════════════════════════════════════════
   VOICE-REACTIVE PARTICLE SPHERE
   ─────────────────────────────────────────────────────────────
   • Reads full frequency array from AnalyserNode every frame
   • Bass band  → sphere scale / beat expansion
   • Mid  band  → rotation speed boost
   • High band  → particle brightness flicker
   • Dual-axis rotation (Y + slow X tilt) for 3D globe feel
   • 320 particles on a Fibonacci sphere
   • Smooth quadratic-Bézier waveform below
   ═══════════════════════════════════════════════════════════════ */
function ParticleSphere({
  voiceState,
  analyserNode,
}: {
  voiceState:   VoiceState;
  analyserNode: AnalyserNode | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    /* ── Canvas dimensions ── */
    const dpr    = window.devicePixelRatio || 1;
    const ORB    = 340;          // orb canvas area
    const WAVE_H = 72;           // waveform strip height
    const W = ORB, H = ORB + WAVE_H;
    canvas.width        = W * dpr;
    canvas.height       = H * dpr;
    canvas.style.width  = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    const cx = W / 2, cy = ORB / 2;

    /* ── Frequency data buffer ── */
    const FFT_SIZE = analyserNode?.frequencyBinCount ?? 128;
    const freqData = new Uint8Array(FFT_SIZE);

    /* ── Fibonacci sphere particles ── */
    const N = 320;
    interface P { theta:number; phi:number; speed:number; size:number; opacity:number; color:string; shimPh:number; }
    const colors = ['rgba(255,255,255,','rgba(190,255,240,','rgba(160,240,225,'];
    const pts: P[] = Array.from({length:N}, (_,i) => ({
      phi:    Math.acos(1 - (2*(i+0.5))/N),
      theta:  Math.PI * (1+Math.sqrt(5)) * i,
      speed:  0.00020 + Math.random() * 0.00030,
      size:   Math.random() < 0.10 ? 3.0 : Math.random() < 0.40 ? 2.0 : 1.4,
      opacity:0.32 + Math.random() * 0.68,
      color:  colors[Math.floor(Math.random()*colors.length)],
      shimPh: Math.random() * Math.PI * 2,
    }));

    /* ── Base config per voice state ── */
    const BASE_R:   Record<VoiceState,number> = { idle:88, listening:92, processing:84, speaking:92 };
    const BASE_ROT: Record<VoiceState,number> = { idle:0.07, listening:0.15, processing:0.10, speaking:0.14 };

    /* ── Animation state (lives in closure, never triggers React re-render) ── */
    let radius   = BASE_R[voiceState];
    let rotY     = 0;    // azimuthal rotation (driven by time)
    let rotXTilt = 0;    // polar tilt oscillation

    /* Smoothed frequency band values */
    let sBass = 0, sMid = 0, sHigh = 0;

    /* Beat pulse */
    let pulse = 0, prevBass = 0;

    /* Waveform ring buffer */
    const WLEN = 220;
    const wBuf = new Float32Array(WLEN);
    let wHead = 0, wSm = 0;

    /* ── Helper: bin average ── */
    const binAvg = (lo:number, hi:number): number => {
      let s = 0, n = Math.max(1, hi-lo);
      for (let b=lo; b<hi && b<FFT_SIZE; b++) s += freqData[b];
      return s / n / 255;        // normalize 0..1
    };

    /* ─────────────────── FRAME ─────────────────── */
    let lastTs = 0;
    function frame(ts: number) {
      const dt = Math.min(ts - lastTs, 50) / 1000;   // seconds, capped at 50 ms
      lastTs = ts;

      /* 1. Pull frequency data if analyser available */
      if (analyserNode) analyserNode.getByteFrequencyData(freqData);

      /* 2. Split into bands:
            Bass  0–8   bins  (fundamental voice energy)
            Mid   8–80  bins  (speech formants)
            High  80–end bins (breath / sibilants) */
      const rawBass = binAvg(0, 9);
      const rawMid  = binAvg(9, 80);
      const rawHigh = binAvg(80, FFT_SIZE);

      /* Smooth each band (different speeds) */
      sBass += (rawBass - sBass) * 0.26;   // fast  — drives beat
      sMid  += (rawMid  - sMid)  * 0.14;   // medium
      sHigh += (rawHigh - sHigh) * 0.10;   // slow

      /* 3. Beat pulse fires on sharp bass rising edge */
      const bassRise = sBass - prevBass;
      if (bassRise > 0.12 && sBass > 0.15) pulse = Math.min(pulse + bassRise * 3.0, 1.0);
      prevBass = sBass;
      pulse   *= 0.91;    // ~0.35 s visible tail

      /* 4. Target radius — bass makes it beat, pulse adds burst */
      const targetR = BASE_R[voiceState]
        + sBass * 38     // ← main beat: up to +38 px on strong voice
        + sMid  *  8     // mid presence adds slight swell
        + pulse * 16;    // burst on onset
      radius += (targetR - radius) * 0.13;

      /* 5. Dual-axis rotation
             Y: continuous azimuthal spin (slightly faster with mid)
             X: slow sinusoidal tilt for 3D globe feel              */
      const rotYSpeed = BASE_ROT[voiceState] + sMid * 0.08;
      rotY     += rotYSpeed * dt;
      rotXTilt  = Math.sin(ts * 0.00025) * 0.28;   // ±16° oscillation

      /* 6. Waveform update */
      wSm += 0.20 * (sBass - wSm);
      wBuf[wHead] = wSm;
      wHead = (wHead + 1) % WLEN;

      /* ── CLEAR ── */
      ctx.clearRect(0, 0, W, H);

      /* ── GLOW: layered radial gradients breathing with beat ── */
      {
        const g1A = (voiceState==='idle'?0.025:0.04) + sBass*0.14 + pulse*0.09;
        const g2A = g1A * 0.25;
        const gc  = voiceState==='speaking'
          ? `rgba(60,120,255,`
          : `rgba(34,197,130,`;
        const gInner = ctx.createRadialGradient(cx,cy, 0, cx,cy, radius*0.6);
        gInner.addColorStop(0,   gc+(g1A*0.6).toFixed(3)+')');
        gInner.addColorStop(1,   'transparent');
        const gOuter = ctx.createRadialGradient(cx,cy, 0, cx,cy, radius+32);
        gOuter.addColorStop(0,   gc+g1A.toFixed(3)+')');
        gOuter.addColorStop(0.5, gc+g2A.toFixed(3)+')');
        gOuter.addColorStop(1,   'transparent');
        ctx.fillStyle = gOuter; ctx.fillRect(0,0,W,ORB);
        ctx.fillStyle = gInner; ctx.fillRect(0,0,W,ORB);
      }

      /* ── PARTICLES (dual-axis rotation projection) ── */
      // Precompute tilt matrices for X rotation (rotXTilt)
      const cosX = Math.cos(rotXTilt), sinX = Math.sin(rotXTilt);

      const projected = pts.map(p => {
        /* Individual rotation: Y-axis spin */
        const th = p.theta + rotY * p.speed * 3000;

        /* Spherical → Cartesian */
        const sPhi = Math.sin(p.phi), cPhi = Math.cos(p.phi);
        const sTh  = Math.sin(th),    cTh  = Math.cos(th);

        let x3 = radius * sPhi * cTh;
        let y3 = radius * cPhi;
        let z3 = radius * sPhi * sTh;

        /* Apply X-axis tilt rotation */
        const y3r =  y3 * cosX + z3 * sinX;
        const z3r = -y3 * sinX + z3 * cosX;
        y3 = y3r; z3 = z3r;

        /* Micro-shimmer — barely perceptible organic life */
        const sh = Math.sin(ts * 0.00016 * p.speed * 4 + p.shimPh) * 1.6;
        const rx = x3 + (x3/radius)*sh;
        const ry = y3 + (y3/radius)*sh;
        const rz = z3 + (z3/radius)*sh;

        /* Perspective */
        const persp = 1 + rz / 850;
        const px = cx + rx / persp;
        const py = cy + ry / persp;

        const depth  = (rz + radius) / (2 * radius);          // 0..1 front-back
        const hFlick = sHigh * 0.18;                           // high-freq flicker
        const bBoost = sBass * 0.16 + pulse * 0.10;
        const opacity= Math.min((0.18 + depth*0.82)*p.opacity + bBoost + hFlick, 1.0);
        const size   = p.size * (0.44 + depth*0.76) * (1 + sBass*0.18);

        return { px, py, rz, opacity, size, color:p.color };
      });

      projected.sort((a,b) => a.rz - b.rz);    // painter's algorithm

      for (const pt of projected) {
        ctx.beginPath();
        ctx.arc(pt.px, pt.py, pt.size, 0, Math.PI*2);
        ctx.fillStyle = pt.color + pt.opacity.toFixed(2) + ')';
        ctx.fill();
      }

      /* ── WAVEFORM — smooth quadratic Bézier ── */
      const wY  = ORB + WAVE_H/2;
      const wAm = WAVE_H * 0.40;

      /* Baseline */
      ctx.beginPath(); ctx.strokeStyle='rgba(255,255,255,0.04)';
      ctx.lineWidth=0.7; ctx.moveTo(0,wY); ctx.lineTo(W,wY); ctx.stroke();

      const wAlpha = voiceState==='idle' ? 0.22 : 0.46 + pulse*0.20;
      const wColor = voiceState==='speaking'
        ? `rgba(90,150,255,${wAlpha.toFixed(2)})`
        : `rgba(52,211,153,${wAlpha.toFixed(2)})`;

      ctx.beginPath();
      ctx.strokeStyle = wColor;
      ctx.lineWidth   = 1.8; ctx.lineJoin='round'; ctx.lineCap='round';
      ctx.shadowColor = voiceState==='speaking'?'rgba(60,120,255,0.30)':'rgba(52,211,153,0.30)';
      ctx.shadowBlur  = sBass > 0.10 ? 7 : 0;

      const wpts: [number,number][] = [];
      for (let i=0; i<WLEN; i++) {
        const v = wBuf[(wHead+i)%WLEN];
        wpts.push([(i/(WLEN-1))*W,  wY - wAm * Math.sin(v*Math.PI*0.5) * v]);
      }
      ctx.moveTo(wpts[0][0], wpts[0][1]);
      for (let i=1; i<wpts.length-1; i++) {
        const mx=(wpts[i][0]+wpts[i+1][0])/2, my=(wpts[i][1]+wpts[i+1][1])/2;
        ctx.quadraticCurveTo(wpts[i][0], wpts[i][1], mx, my);
      }
      ctx.lineTo(wpts[wpts.length-1][0], wpts[wpts.length-1][1]);
      ctx.stroke(); ctx.shadowBlur=0;

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState, analyserNode]);

  return <canvas ref={canvasRef} className="particle-canvas" />;
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */
const uid = () => crypto.randomUUID();

const SUGGESTIONS = [
  { icon:'🌤️', title:"What's the weather today?",  sub:'Get real-time info'   },
  { icon:'🎵', title:'Play some music on Spotify',  sub:'Control your media'   },
  { icon:'💡', title:'Help me focus for 30 mins',   sub:'Start a work session' },
  { icon:'🖥️', title:"What's running on my PC?",    sub:'System overview'      },
];

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export function NovaInterface() {
  const [conversations, setConversations] = useState<Conversation[]>([
    { id:uid(), label:'New conversation', messages:[] },
  ]);
  const [activeId, setActiveId]           = useState<string>(conversations[0].id);
  const [inputValue, setInputValue]       = useState('');
  const [generating, setGenerating]       = useState(false);
  const [memories, setMemories]           = useState<Memory[]>([]);
  const [newMemory, setNewMemory]         = useState('');
  const [time, setTime]                   = useState('');
  const [backendStatus, setBackendStatus] = useState<'online'|'offline'|'checking'>('checking');
  const [searchQuery, setSearchQuery]     = useState('');

  const [voiceOpen,       setVoiceOpen]       = useState(false);
  const [voiceState,      setVoiceState]      = useState<VoiceState>('idle');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceResponse,   setVoiceResponse]   = useState('');
  /* Pass the AnalyserNode itself — sphere reads full freq array */
  const [analyserNode, setAnalyserNode]       = useState<AnalyserNode|null>(null);

  const chatEndRef     = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const cancelRef      = useRef<AbortController|null>(null);
  const isSpeakingRef  = useRef(false);
  const isProcessRef   = useRef(false);
  const audioCtxRef    = useRef<AudioContext|null>(null);
  const audioRafRef    = useRef<number>(0);

  const activeConv    = conversations.find(c => c.id === activeId)!;
  const messages      = activeConv?.messages ?? [];
  const filteredConvs = conversations.filter(c =>
    c.label.toLowerCase().includes(searchQuery.toLowerCase()));

  /* ── Clock ── */
  useEffect(() => {
    const tick = () => setTime(
      new Date().toLocaleTimeString('en-IN',{hour12:false,hour:'2-digit',minute:'2-digit'}));
    tick(); const t = setInterval(tick,1000); return ()=>clearInterval(t);
  }, []);

  /* ── Backend health ── */
  useEffect(() => {
    fetch('http://localhost:5001/api/memory',{signal:AbortSignal.timeout(3000)})
      .then(r=>setBackendStatus(r.ok?'online':'offline'))
      .catch(()=>setBackendStatus('offline'));
  }, []);

  /* ── Memories ── */
  useEffect(() => { const s=localStorage.getItem('nova_memories_v2'); if(s) setMemories(JSON.parse(s)); }, []);
  const saveMemories = (m:Memory[]) => { localStorage.setItem('nova_memories_v2',JSON.stringify(m)); setMemories(m); };

  useEffect(()=>{ chatEndRef.current?.scrollIntoView({behavior:'smooth'}); },[messages]);
  useEffect(()=>{
    const ta=textareaRef.current; if(!ta) return;
    ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,200)+'px';
  },[inputValue]);

  const patchMessages = useCallback((id:string,fn:(m:Message[])=>Message[])=>
    setConversations(p=>p.map(c=>c.id===id?{...c,messages:fn(c.messages)}:c)),[]);
  const updateLabel = useCallback((id:string,label:string)=>
    setConversations(p=>p.map(c=>c.id===id?{...c,label}:c)),[]);

  const addMemory = useCallback(()=>{
    const text=newMemory.trim(); if(!text) return;
    saveMemories([{id:uid(),text,timestamp:new Date().toLocaleString('en-IN')},...memories].slice(0,50));
    setNewMemory('');
  },[newMemory,memories]);
  const deleteMemory = useCallback((id:string)=>saveMemories(memories.filter(m=>m.id!==id)),[memories]);

  const newConversation = useCallback(()=>{
    const c:Conversation={id:uid(),label:'New conversation',messages:[]};
    setConversations(p=>[c,...p]); setActiveId(c.id); setInputValue('');
  },[]);

  /* ═══ CHAT SEND ═══ */
  const send = useCallback(async(textOverride?:string)=>{
    const text=(textOverride??inputValue).trim();
    if(!text||generating) return;
    setGenerating(true); setInputValue('');

    const convId=activeId, uid2=uid(), uid3=uid();
    if(messages.length===0) updateLabel(convId,text.slice(0,40)+(text.length>40?'…':''));
    patchMessages(convId,msgs=>[...msgs,
      {id:uid2,role:'user',text},
      {id:uid3,role:'assistant',text:'',streaming:true}]);

    const ctrl=new AbortController(); cancelRef.current=ctrl;
    try {
      const cmd=await fetch('http://localhost:5001/api/command',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({command:text}),signal:ctrl.signal,
      }).catch(()=>null);
      if(cmd?.ok){
        const d=await cmd.json();
        if(d.status!=='not_a_command'){
          patchMessages(convId,msgs=>msgs.map(m=>m.id===uid3?{...m,text:d.speak||d.status,streaming:false}:m));
          return;
        }
      }
      const r=await fetch('http://localhost:5001/api/chat',{
        method:'POST',headers:{'Content-Type':'application/json'},signal:ctrl.signal,
        body:JSON.stringify({messages:[
          ...messages.map(m=>({role:m.role,content:m.text})),
          {role:'user',content:text}]}),
      });
      if(!r.ok) throw new Error(`Backend ${r.status}`);
      const reader=r.body!.getReader(), dec=new TextDecoder(); let acc='';
      while(true){const{done,value}=await reader.read();if(done)break;
        acc+=dec.decode(value,{stream:true});
        patchMessages(convId,msgs=>msgs.map(m=>m.id===uid3?{...m,text:acc}:m));}
      patchMessages(convId,msgs=>msgs.map(m=>m.id===uid3?{...m,streaming:false}:m));
    } catch(err){
      if((err as Error).name==='AbortError') return;
      patchMessages(convId,msgs=>msgs.map(m=>m.id===uid3
        ?{...m,text:`Error: ${err instanceof Error?err.message:String(err)}`,streaming:false}:m));
    } finally { cancelRef.current=null; setGenerating(false); }
  },[inputValue,generating,activeId,messages,patchMessages,updateLabel]);

  const onKeyDown=(e:KeyboardEvent<HTMLTextAreaElement>)=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}};

  /* ═══ AUDIO METER — returns AnalyserNode ═══ */
  const startAudioMeter = async (): Promise<AnalyserNode|null> => {
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({audio:true});
      const actx     = new AudioContext();
      const analyser = actx.createAnalyser();
      analyser.fftSize         = 256;
      analyser.smoothingTimeConstant = 0.75;  // built-in WebAudio smoothing
      actx.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = actx;
      return analyser;
    } catch { return null; }
  };

  const stopAudioMeter = () => {
    cancelAnimationFrame(audioRafRef.current);
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setAnalyserNode(null);
  };

  /* ═══ VOICE ═══ */
  const cleanTTS = (t:string) =>
    t.replace(/\*\*(.*?)\*\*/g,'$1').replace(/\*(.*?)\*/g,'$1')
     .replace(/`.*?`/g,'').replace(/#{1,6}\s/g,'').replace(/\n/g,' ').trim();

  const speakText = useCallback((text:string,onEnd?:()=>void)=>{
    if(!window.speechSynthesis){onEnd?.();return;}
    window.speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(cleanTTS(text));
    u.lang='en-IN'; u.rate=1.05;
    u.onstart=()=>{isSpeakingRef.current=true;};
    u.onend=()=>{isSpeakingRef.current=false;onEnd?.();};
    u.onerror=()=>{isSpeakingRef.current=false;onEnd?.();};
    window.speechSynthesis.speak(u);
  },[]);

  const listenRef = useRef<()=>void>(()=>{});

  const processVoice = useCallback(async(text:string)=>{
    if(!text.trim()||isProcessRef.current) return;
    isProcessRef.current=true;
    setVoiceTranscript(text); setVoiceState('processing'); setVoiceResponse('');
    try {
      const cmd=await fetch('http://localhost:5001/api/command',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({command:text}),
      }).catch(()=>null);
      if(cmd?.ok){
        const d=await cmd.json();
        if(d.status!=='not_a_command'){
          const reply=d.speak||d.status;
          setVoiceResponse(reply); setVoiceState('speaking');
          speakText(reply,()=>{setVoiceState('listening');isProcessRef.current=false;listenRef.current();});
          return;
        }
      }
      const res=await fetch('http://localhost:5001/api/chat',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({messages:[{role:'user',content:text}]}),
      });
      if(!res.ok) throw new Error();
      const reader=res.body!.getReader(),dec=new TextDecoder(); let acc='';
      while(true){const{done,value}=await reader.read();if(done)break;
        acc+=dec.decode(value,{stream:true}); setVoiceResponse(acc);}
      setVoiceState('speaking');
      speakText(acc,()=>{setVoiceState('listening');isProcessRef.current=false;listenRef.current();});
    } catch {setVoiceState('idle');isProcessRef.current=false;}
  },[speakText]);

  useEffect(()=>{
    listenRef.current=()=>{
      if(!voiceOpen) return;
      const SR=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
      if(!SR) return;
      const rec=new SR();
      rec.lang='en-IN'; rec.continuous=false; rec.interimResults=false;
      rec.onstart=()=>setVoiceState('listening');
      rec.onresult=(e:any)=>processVoice(e.results[0][0].transcript);
      rec.onerror=(e:any)=>{if(e.error!=='aborted') setVoiceState('idle');};
      rec.onend=()=>{if(!isProcessRef.current&&!isSpeakingRef.current&&voiceOpen) setVoiceState('idle');};
      recognitionRef.current=rec;
      try{rec.start();}catch{}
    };
  },[voiceOpen,processVoice]);

  const openVoice = useCallback(async()=>{
    setVoiceOpen(true); setVoiceTranscript(''); setVoiceResponse('');
    setVoiceState('listening');
    isProcessRef.current=false; isSpeakingRef.current=false;
    const an = await startAudioMeter();
    setAnalyserNode(an);
    setTimeout(()=>listenRef.current(), 120);
  },[]);

  const closeVoice = useCallback(()=>{
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
    stopAudioMeter();
    setVoiceOpen(false); setVoiceState('idle');
    setVoiceTranscript(''); setVoiceResponse('');
    isProcessRef.current=false; isSpeakingRef.current=false;
  },[]);

  const toggleMic = useCallback(()=>{
    if(voiceState==='listening'){recognitionRef.current?.stop();setVoiceState('idle');}
    else if(voiceState==='idle') listenRef.current();
  },[voiceState]);

  const copyMsg=(text:string)=>navigator.clipboard.writeText(text).catch(()=>{});

  const stateLabel:Record<VoiceState,string>={
    idle:'Tap the mic to speak',listening:'Listening…',processing:'Thinking…',speaking:'Speaking…'};

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */
  return (
    <div className="nova-shell">
      {/* SIDEBAR */}
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
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
            </svg>
            <input className="sidebar-search-input" placeholder="Search conversations"
              value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/>
          </div>
        </div>

        <div className="sidebar-section-label">Recents</div>
        <div className="sidebar-history">
          {filteredConvs.map(conv=>(
            <div key={conv.id}
              className={`history-item ${conv.id===activeId?'active':''}`}
              onClick={()=>setActiveId(conv.id)}>
              <span className="history-item-icon">💬</span>
              <span className="history-item-label">{conv.label}</span>
            </div>
          ))}
        </div>

        <div className="memory-panel">
          <div className="memory-panel-header">
            <span className="memory-panel-title">Memories</span>
            {memories.length>0&&<button className="memory-clear-btn" onClick={()=>saveMemories([])}>Clear all</button>}
          </div>
          <div className="memory-add-row">
            <input className="memory-input" placeholder="Add a memory…"
              value={newMemory} onChange={e=>setNewMemory(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&addMemory()}/>
            <button className="memory-add-btn" onClick={addMemory}>+</button>
          </div>
          <div className="memory-list">
            {memories.map(m=>(
              <div key={m.id} className="memory-chip">
                <span className="memory-chip-text">{m.text}</span>
                <button className="memory-chip-del" onClick={()=>deleteMemory(m.id)}>✕</button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-status">
          <div className={`status-dot ${backendStatus==='online'?'':backendStatus==='offline'?'red':'amber'}`}/>
          <span>{backendStatus==='online'?'Backend connected':backendStatus==='offline'?'Backend offline':'Connecting…'}</span>
        </div>
      </aside>

      {/* MAIN */}
      <main className="nova-main">
        <div className="topbar">
          <div className="topbar-left">
            <div className="model-selector">
              <div className="model-selector-icon"/>
              <span>NOVA AI</span>
              <span className="model-selector-chevron">▾</span>
            </div>
          </div>
          <div className="topbar-right">
            <div className="topbar-badge"><span style={{fontSize:10}}>⚡</span><span>Groq · Llama 3.3</span></div>
            <div className="topbar-time">{time}</div>
          </div>
        </div>

        <div className="chat-area">
          {messages.length===0?(
            <div className="welcome-screen">
              <div className="welcome-logo">⚡</div>
              <h1 className="welcome-title">How can I help?</h1>
              <p className="welcome-subtitle">
                I'm NOVA — your personal AI. Ask me anything, control your computer,
                manage music, set reminders, and more.
              </p>
              <div className="welcome-suggestions">
                {SUGGESTIONS.map((s,i)=>(
                  <button key={i} className="suggestion-card" onClick={()=>send(s.title)}>
                    <span className="suggestion-card-icon">{s.icon}</span>
                    <span className="suggestion-card-title">{s.title}</span>
                    <span className="suggestion-card-sub">{s.sub}</span>
                  </button>
                ))}
              </div>
              <button className="welcome-voice-btn" onClick={openVoice}>
                <span className="welcome-voice-icon">🎙️</span>
                <span>Start voice conversation</span>
              </button>
            </div>
          ):(
            <div className="messages-container">
              {messages.map(msg=><MessageRow key={msg.id} msg={msg} onCopy={copyMsg}/>)}
              <div ref={chatEndRef}/>
            </div>
          )}
        </div>

        <div className="input-area">
          <div className="input-wrapper">
            <div className="input-box">
              <textarea ref={textareaRef} className="input-textarea"
                placeholder="Message NOVA…" rows={1}
                value={inputValue} onChange={e=>setInputValue(e.target.value)}
                onKeyDown={onKeyDown} disabled={generating}/>
              <div className="input-toolbar">
                <button className="input-tool-btn" onClick={openVoice}>🎙️ Voice</button>
                <div className="input-spacer"/>
                {generating
                  ?<button className="send-btn" onClick={()=>{cancelRef.current?.abort();setGenerating(false);}}>⏹</button>
                  :<button className="send-btn" onClick={()=>send()} disabled={!inputValue.trim()}>↑</button>
                }
              </div>
            </div>
            <p className="input-hint">NOVA can make mistakes. Verify important info.</p>
          </div>
        </div>
      </main>

      {/* VOICE OVERLAY */}
      {voiceOpen&&(
        <div className="va-overlay">
          <button className="va-close" onClick={closeVoice} title="Close">✕</button>

          <div className="va-orb-section">
            {/* Sphere reads raw frequency data directly from AnalyserNode */}
            <ParticleSphere voiceState={voiceState} analyserNode={analyserNode}/>
          </div>

          <div className="va-text-section">
            {voiceTranscript
              ?<p className="va-transcript">{voiceTranscript}</p>
              :<p className="va-prompt-hint">Say something…</p>
            }
            {voiceResponse&&<p className="va-response">{voiceResponse}</p>}
          </div>

          <div className="va-controls">
            <button className={`va-mic-btn ${voiceState==='listening'?'active':''}`}
              onClick={toggleMic}
              disabled={voiceState==='processing'||voiceState==='speaking'}>
              {voiceState==='listening'
                ?<span className="va-mic-icon">⏹</span>
                :voiceState==='processing'
                  ?<span className="va-processing-icon">⋯</span>
                  :voiceState==='speaking'
                    ?<span className="va-mic-icon">🔊</span>
                    :<span className="va-mic-icon">🎙️</span>}
            </button>
          </div>
          <p className="va-state-label">{stateLabel[voiceState]}</p>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MESSAGE ROW
   ═══════════════════════════════════════════════════════════════ */
function MessageRow({msg,onCopy}:{msg:Message;onCopy:(t:string)=>void}) {
  const isUser=msg.role==='user', isSys=msg.role==='system';
  return (
    <div className={`message-row${isSys?' system':''}`}>
      <div className={`message-avatar ${isUser?'user':'assistant'}`}>
        {isUser?'👤':isSys?'⚙️':'⚡'}
      </div>
      <div className="message-body">
        <div className="message-role">{isUser?'You':isSys?'System':'NOVA'}</div>
        {msg.text===''&&msg.streaming
          ?<div className="typing-indicator">
            <div className="typing-dot"/><div className="typing-dot"/><div className="typing-dot"/>
           </div>
          :<div className={`message-text${msg.streaming?' streaming':''}`}>{msg.text}</div>
        }
        {!msg.streaming&&msg.text&&(
          <div className="message-actions">
            <button className="msg-action-btn" onClick={()=>onCopy(msg.text)}>📋 Copy</button>
          </div>
        )}
      </div>
    </div>
  );
}