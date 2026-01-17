import { useState, useCallback } from 'react';
import { Sidebar } from '@/components/chat/Sidebar';
import { TopBar } from '@/components/chat/TopBar';
import { ChatArea } from '@/components/chat/ChatArea';
import { ChatInput } from '@/components/chat/ChatInput';
import { WOODY_SYSTEM_PROMPT } from '@/constants/systemPrompt';
import type { ChatMessage, TopicId, UploadedFile } from '@/types/chat';

export default function Index() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTopic, setActiveTopic] = useState<TopicId>('techniques-integration');
  const [isTyping, setIsTyping] = useState(false);
  const [showSetupFirst, setShowSetupFirst] = useState(false);
  const [woodyCoaching, setWoodyCoaching] = useState(true);

  const handleClearChat = useCallback(() => {
    setMessages([]);
  }, []);

  const handleSendMessage = useCallback(async (content: string, files: UploadedFile[]) => {
    // Create user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      files: files.length > 0 ? files : undefined,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);

    try {
      // Prepare form data for multipart/form-data submission
      const formData = new FormData();
      formData.append('message', content);
      formData.append('systemPrompt', WOODY_SYSTEM_PROMPT);
      formData.append('topic', activeTopic);
      formData.append('showSetupFirst', String(showSetupFirst));
      formData.append('woodyCoaching', String(woodyCoaching));
      
      // Append files
      files.forEach((file, index) => {
        formData.append(`file_${index}`, file.file);
      });

      // Call the API
      const response = await fetch('/api/chat', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        // Surface serverless error text to make debugging on Vercel simple.
        const errText = await response.text().catch(() => '');
        throw new Error(
          `API /api/chat failed (${response.status}). ${errText.slice(0, 800)}`
        );
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      // Create assistant message placeholder
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      };

      setMessages(prev => [...prev, assistantMessage]);
      setIsTyping(false);

      // Stream the response
      let fullContent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullContent += chunk;

        setMessages(prev => 
          prev.map(msg => 
            msg.id === assistantMessage.id 
              ? { ...msg, content: fullContent }
              : msg
          )
        );
      }

      // Mark streaming as complete
      setMessages(prev =>
        prev.map(msg =>
          msg.id === assistantMessage.id
            ? { ...msg, isStreaming: false }
            : msg
        )
      );

    } catch (error) {
      console.error('Error sending message:', error);
      setIsTyping(false);

      // Add error message
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          error instanceof Error
            ? `Server error: ${error.message}`
            : 'I apologize, but I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  }, [activeTopic, showSetupFirst, woodyCoaching]);

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <Sidebar 
        activeTopic={activeTopic} 
        onTopicChange={setActiveTopic} 
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen">
        <TopBar
          onClearChat={handleClearChat}
          showSetupFirst={showSetupFirst}
          onShowSetupFirstChange={setShowSetupFirst}
          woodyCoaching={woodyCoaching}
          onWoodyCoachingChange={setWoodyCoaching}
        />
        
        <ChatArea 
          messages={messages} 
          isTyping={isTyping} 
        />
        
        <ChatInput 
          onSend={handleSendMessage} 
          isLoading={isTyping} 
        />
      </main>
    </div>
  );
}
