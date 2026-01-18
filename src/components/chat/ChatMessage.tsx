import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { User, Bot, FileText, Image as ImageIcon } from 'lucide-react';
import 'katex/dist/katex.min.css';
import katex from 'katex';
import type { ChatMessage as ChatMessageType } from '@/types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
}

function renderMathContent(content: string): string {
  let processed = content;

  // Process display math: \[...\]
  processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    try {
      return `<div class="katex-display">${katex.renderToString(math.trim(), { 
        displayMode: true,
        throwOnError: false 
      })}</div>`;
    } catch {
      return `<code>${math}</code>`;
    }
  });

  // Process display math: $$...$$
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    try {
      return `<div class="katex-display">${katex.renderToString(math.trim(), { 
        displayMode: true,
        throwOnError: false 
      })}</div>`;
    } catch {
      return `<code>${math}</code>`;
    }
  });

  // Process inline math: \(...\)
  processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { 
        displayMode: false,
        throwOnError: false 
      });
    } catch {
      return `<code>${math}</code>`;
    }
  });

  // Process inline math: $...$
  processed = processed.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { 
        displayMode: false,
        throwOnError: false 
      });
    } catch {
      return `<code>${math}</code>`;
    }
  });

  // Convert markdown-style bold **text** to <strong>
  processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Convert markdown tables to HTML tables
  processed = processed.replace(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/g, (match, header, body) => {
    const headerCells = header.split('|').filter((c: string) => c.trim()).map((c: string) => `<th style="border: 1px solid hsl(var(--border)); padding: 8px; text-align: center;">${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map((row: string) => {
      const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td style="border: 1px solid hsl(var(--border)); padding: 8px; text-align: center;">${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table style="border-collapse: collapse; margin: 1rem 0; width: auto;"><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Convert newlines to <br> for basic formatting
  processed = processed.replace(/\n/g, '<br>');

  return processed;
}

export const ChatMessage = memo(function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  
  const renderedContent = useMemo(() => {
    return renderMathContent(message.content);
  }, [message.content]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <div className={`
        w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
        ${isUser 
          ? 'bg-secondary border border-border' 
          : 'bg-primary/12 border border-primary/20'
        }
      `}>
        {isUser 
          ? <User className="w-4 h-4 text-muted-foreground" /> 
          : <Bot className="w-4 h-4 text-primary" />
        }
      </div>

      {/* Message Content */}
      <div className={`flex-1 max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Role Label */}
        <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 px-0.5 ${
          isUser ? 'text-right text-muted-foreground/60' : 'text-left text-primary/60'
        }`}>
          {isUser ? 'You' : 'Professor Woody'}
        </p>

        <div className={`
          rounded-xl px-4 py-3 message-content
          ${isUser 
            ? 'bg-secondary border border-border text-secondary-foreground rounded-tr-sm' 
            : 'bg-surface-elevated border border-border/60 text-foreground rounded-tl-sm'
          }
        `}
        style={{
          backgroundColor: isUser ? undefined : 'hsl(var(--surface-elevated))'
        }}
        >
          {/* Attached Files */}
          {message.files && message.files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3 pb-2.5 border-b border-border/40">
              {message.files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-background/60 text-[11px] font-medium border border-border/40"
                >
                  {file.type === 'pdf' ? (
                    <FileText className="w-3 h-3 text-primary" />
                  ) : (
                    <ImageIcon className="w-3 h-3 text-primary" />
                  )}
                  <span className="truncate max-w-[100px] text-muted-foreground">{file.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Message Text with Math */}
          <div 
            className="text-[16px] leading-[1.8] tracking-[-0.01em]"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />

          {/* Streaming indicator */}
          {message.isStreaming && (
            <span className="inline-flex gap-1 ml-1.5 align-middle">
              <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          )}
        </div>

        {/* Timestamp */}
        <p className={`text-[9px] font-medium text-muted-foreground/50 mt-1.5 px-0.5 tracking-wide ${isUser ? 'text-right' : 'text-left'}`}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </motion.div>
  );
});
