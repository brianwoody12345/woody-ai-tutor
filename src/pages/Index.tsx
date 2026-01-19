import { useState, useCallback, useRef } from 'react';
import { Sidebar } from '@/components/chat/Sidebar';
import { TopBar } from '@/components/chat/TopBar';
import { ChatArea } from '@/components/chat/ChatArea';
import { ChatInput } from '@/components/chat/ChatInput';
import { API_BASE_URL } from '@/constants/apiBaseUrl';
import { toast } from '@/components/ui/sonner';
import type { ChatMessage, TopicId, UploadedFile } from '@/types/chat';

export default function Index() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTopic, setActiveTopic] = useState<TopicId>('techniques-integration');

  // "Typing indicator" (bubble that says Professor Woody is typing)
  const [isTyping, setIsTyping] = useState(false);

  // HARD lock while request/stream is active (prevents double charges)
  const [isBusy, setIsBusy] = useState(false);

  const [showSetupFirst, setShowSetupFirst] = useState(false);
  const [woodyCoaching, setWoodyCoaching] = useState(true);

  // Refs to prevent stale closure + double-send
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleClearChat = useCallback(() => {
    // Optional: abort any in-flight stream when clearing
    try {
      abortRef.current?.abort();
    } catch {
      // ignore
    } finally {
      abortRef.current = null;
      inFlightRef.current = false;
      setIsBusy(false);
      setIsTyping(false);
    }

    setMessages([]);
  }, []);

  const handleTestConnection = useCallback(async () => {
    const healthUrl = `${API_BASE_URL}/api/health`;

    try {
      const res = await fetch(healthUrl, {
        method: 'GET',
        // keep it simple; if CORS is broken, this will throw
      });

      const contentType = res.headers.get('content-type') || '';
      const allowOrigin = res.headers.get('access-control-allow-origin');

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Health failed (${res.status}). ${text.slice(0, 300)}`);
      }

      if (!contentType.includes('application/json')) {
        const text = await res.text().catch(() => '');
        throw new Error(`Health returned non-JSON (${contentType || 'unknown'}): ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as { ok?: boolean; hasOpenAIKey?: boolean; model?: string };

      toast.success('Backend reachable', {
        description: `ok=${Boolean(data.ok)} • key=${data.hasOpenAIKey ? 'yes' : 'no'} • model=${data.model || 'unknown'}${allowOrigin ? ` • ACAO=${allowOrigin}` : ''}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Backend NOT reachable from Preview', {
        description: `${msg} (likely CORS or deploy not updated)`,
      });
    }
  }, []);

  // Helper to convert file to base64
  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const handleSendMessage = useCallback(
    async (content: string, files: UploadedFile[]) => {
      const trimmed = (content || '').trim();
      if (!trimmed && files.length === 0) return;

      // ✅ Prevent double-submit / overlapping API calls (big cost saver)
      if (inFlightRef.current || isBusy) return;

      inFlightRef.current = true;
      setIsBusy(true);

      // Create user message
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed || 'Please analyze this file.',
        files: files.length > 0 ? files : undefined,
        timestamp: new Date(),
      };

      // Add user message to state
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);

      // Show typing indicator while we wait for first bytes back
      setIsTyping(true);

      // Abort controller for this request
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Convert files to base64 for API
        const filesData = await Promise.all(
          files.map(async (f) => ({
            name: f.name,
            type: f.file.type,
            data: await fileToBase64(f.file),
          }))
        );

        // Build conversation history for context (without file data for older messages)
        const conversationHistory = updatedMessages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        // IMPORTANT:
        // - In dev, Vite proxies /api -> VERCEL_BACKEND.
        // - In Lovable Preview/Published, the proxy is not used; we must call the backend directly.
        const chatUrl = `${API_BASE_URL}/api/chat`;

        // Send as JSON with full conversation history and current files
        const response = await fetch(chatUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: trimmed || 'Please analyze this file.',
            messages: conversationHistory,
            files: filesData,
            topic: activeTopic,
            showSetupFirst,
            woodyCoaching,
          }),
          signal: controller.signal,
        });
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          throw new Error('Chat backend did not respond (got HTML). Please try again in a moment.');
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`API chat failed (${response.status}). ${errText.slice(0, 800)}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('No response body');
        }

        // Create assistant message placeholder
        const assistantId = crypto.randomUUID();
        const assistantMessage: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Stop the typing indicator once streaming begins
        setIsTyping(false);

        let fullContent = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          if (chunk) {
            fullContent += chunk;

            setMessages((prev) =>
              prev.map((msg) => (msg.id === assistantId ? { ...msg, content: fullContent } : msg))
            );
          }
        }

        // Mark streaming as complete
        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantId ? { ...msg, isStreaming: false } : msg))
        );
      } catch (error) {
        console.error('Error sending message:', error);

        // Stop typing indicator
        setIsTyping(false);

        // Only show error if not aborted
        if (error instanceof Error && error.name !== 'AbortError') {
          const errorMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Server error: ${error.message}`,
            timestamp: new Date(),
          };

          setMessages((prev) => [...prev, errorMessage]);
        }
      } finally {
        // ✅ Release lock no matter what
        abortRef.current = null;
        inFlightRef.current = false;
        setIsBusy(false);
      }
    },
    [messages, activeTopic, showSetupFirst, woodyCoaching, isBusy, fileToBase64]
  );

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar activeTopic={activeTopic} onTopicChange={setActiveTopic} />

      <main className="flex-1 flex flex-col min-h-screen">
        <TopBar
          onClearChat={handleClearChat}
          onTestConnection={handleTestConnection}
          showSetupFirst={showSetupFirst}
          onShowSetupFirstChange={setShowSetupFirst}
          woodyCoaching={woodyCoaching}
          onWoodyCoachingChange={setWoodyCoaching}
        />

        <ChatArea messages={messages} isTyping={isTyping} />

        {/* ✅ IMPORTANT: lock input while streaming to prevent extra API calls */}
        <ChatInput onSend={handleSendMessage} isLoading={isBusy} />
      </main>
    </div>
  );
}

