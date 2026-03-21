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
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: 'assistant', text: '' };

    setMessages(prev => [...prev, userMsg, assistantMsg]);

    const controller = new AbortController();
    cancelRef.current = controller;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          stream: true,
          system: `You are NOVA, an advanced AI assistant with a sleek, futuristic personality. 
                   Be helpful, concise, and slightly futuristic in tone.`,
          messages: [
            // include full history for context
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
            const delta = parsed.delta?.text;
            if (delta) {
              accumulated += delta;
              setMessages(prev =>
                prev.map(m => m.id === assistantId ? { ...m, text: accumulated } : m)
              );
            }
          } catch {}
        }
      }

    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, text: `Error: ${msg}` } : m)
      );
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
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
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