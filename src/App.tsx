import { NovaInterface } from './components/NovaInterface';
import { useState, useEffect } from 'react';
import { getAccelerationMode } from './runanywhere';
import { VisionTab } from './components/VisionTab';
import { VoiceTab } from './components/VoiceTab';
import { ToolsTab } from './components/ToolsTab';

type Tab = 'chat' | 'vision' | 'voice' | 'tools';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [accel, setAccel] = useState<string | null>(null);

  useEffect(() => {
    // Only init SDK lazily if Vision/Voice tabs are needed
    // Don't block the UI on startup anymore
    try {
      const mode = getAccelerationMode();
      setAccel(mode);
    } catch {
      // SDK not init yet — that's fine
    }
  }, []);

  return (
    <>
      {/* 🔥 Your main futuristic UI — loads instantly now */}
      <NovaInterface />

      {/* 🔒 Hidden debug panel */}
      <div className="app" style={{ display: 'none' }}>
        <header className="app-header">
          <h1>NOVA AI</h1>
          {accel && (
            <span className="badge">
              {accel === 'webgpu' ? 'WebGPU 🚀' : 'CPU 🛡️'}
            </span>
          )}
        </header>

        <nav className="tab-bar">
          <button className={activeTab === 'chat' ? 'active' : ''} onClick={() => setActiveTab('chat')}>💬 Chat</button>
          <button className={activeTab === 'vision' ? 'active' : ''} onClick={() => setActiveTab('vision')}>📷 Vision</button>
          <button className={activeTab === 'voice' ? 'active' : ''} onClick={() => setActiveTab('voice')}>🎙️ Voice</button>
          <button className={activeTab === 'tools' ? 'active' : ''} onClick={() => setActiveTab('tools')}>🔧 Tools</button>
        </nav>

        <main className="tab-content">
          {activeTab === 'vision' && <VisionTab />}
          {activeTab === 'voice' && <VoiceTab />}
          {activeTab === 'tools' && <ToolsTab />}
        </main>
      </div>
    </>
  );
}