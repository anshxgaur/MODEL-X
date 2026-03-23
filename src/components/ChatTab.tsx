import { useState, useRef, useEffect, useCallback } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export function ChatTab() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const cancelRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || generating) return;

    setGenerating(true);
    setInput('');

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', text };

    // Add user message immediately
    setMessages(prev => [...prev, userMsg]);

    const controller = new AbortController();
    cancelRef.current = controller;

    try {
      // ── STEP 1: Check for System/OS Commands ──
      const commandRes = await fetch('http://localhost:5000/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: text }),
      });

      if (commandRes.ok) {
        const commandData = await commandRes.json();

        // If the backend recognized and executed a command, show it and exit
        if (commandData.status !== 'not_a_command') {
          const systemMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: `⚡ SYSTEM: ${commandData.speak || commandData.status}`
          };
          setMessages(prev => [...prev, systemMsg]);
          setGenerating(false);
          return; // Stop here, no need to ask the LLM
        }
      }

      // ── STEP 2: Standard LLM Chat (Cache → Ollama → Groq) ──
      // If it wasn't a command, create the empty assistant bubble for streaming
      const assistantId = crypto.randomUUID();
      const assistantMsg: Message = { id: assistantId, role: 'assistant', text: '' };
      setMessages(prev => [...prev, assistantMsg]);

      const chatRes = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...messages.map(m => ({ role: m.role, content: m.text })),
            { role: 'user', content: text }
          ],
        }),
      });

      if (!chatRes.ok) throw new Error(`Backend error: ${chatRes.status}`);

      const reader = chatRes.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, text: accumulated } : m)
        );
      }

    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);

      setMessages(prev => {
        // If we failed during streaming, update the last bubble. Otherwise, append a new error bubble.
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.text === '') {
          return prev.map(m => m.id === lastMsg.id ? { ...m, text: `Error: ${msg}` } : m);
        } else {
          return [...prev, { id: crypto.randomUUID(), role: 'assistant', text: `Error: ${msg}` }];
        }
      });
    } finally {
      cancelRef.current = null;
      setGenerating(false);
    }
  }, [input, generating, messages]);

  const handleCancel = () => {
    cancelRef.current?.abort();
    setGenerating(false);
  };

  return (
    <div className="tab-panel chat-panel">
      <div className="message-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <h3>Start a conversation</h3>
            <p>Type a message below to chat with NOVA</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`message message-${msg.role}`}>
            <div className="message-bubble">
              <p>{msg.text || '...'}</p>
            </div>
          </div>
        ))}
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          type="text"
          placeholder="Message NOVA..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={generating}
          onKeyDown={(e) => { if (e.key === 'Enter' && !generating) { e.preventDefault(); send(); } }}
        />
        {generating ? (
          <button type="button" className="btn" onClick={handleCancel}>Stop</button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!input.trim()}>Send</button>
        )}
      </form>
    </div>
  );
}