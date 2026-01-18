import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { User, Bot, FileText, Image as ImageIcon } from 'lucide-react';
import 'katex/dist/katex.min.css';
import katex from 'katex';
import type { ChatMessage as ChatMessageType } from '@/types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

type ParsedIbpRow = { sign: string; u: string; dv: string };

function parseIbpAsciiTable(codeRaw: string): { rows: ParsedIbpRow[] } | null {
  const code = String(codeRaw ?? '').trim();
  const lines = code.split('\n').map((l) => l.trim()).filter(Boolean);

  // Must contain header like: "sign u dv" (spaces) OR "sign | u | dv"
  const headerIdx = lines.findIndex((l) =>
    /^sign(\s+|\s*\|\s*)u(\s+|\s*\|\s*)dv$/i.test(l)
  );
  if (headerIdx === -1) return null;

  const dataLines = lines.slice(headerIdx + 1);

  const rows: ParsedIbpRow[] = [];
  for (const l of dataLines) {
    // expected like: "+   e^x   \cos(x) \, dx"
    // or with pipes: "| + | e^x | \cos(x) \, dx |"
    let sign = '';
    let u = '';
    let dv = '';

    if (l.includes('|')) {
      const parts = l
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 3) {
        sign = parts[0];
        u = parts[1];
        dv = parts[2];
      }
    } else {
      // split on 2+ spaces so LaTeX tokens stay intact
      const parts = l.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        sign = parts[0];
        u = parts[1];
        dv = parts.slice(2).join(' ');
      }
    }

    if (!sign || !u || !dv) continue;
    if (!/^[+\-]$/.test(sign)) continue;

    rows.push({ sign, u, dv });
    if (rows.length >= 6) break; // safety
  }

  // We only “pretty render” if it looks like the 3-row Type II setup (common case)
  if (rows.length >= 2) return { rows };
  return null;
}

function renderIbpPrettyTable(rows: ParsedIbpRow[]): string {
  const rowHtml = rows
    .slice(0, 3)
    .map((r) => {
      const signColor =
        r.sign === '+'
          ? 'hsl(var(--primary))'
          : 'hsl(var(--destructive, 0 84% 60%))';

      return `
        <div style="
          display: grid;
          grid-template-columns: 60px 1fr 1.6fr;
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
          border-top: 1px solid hsl(var(--border) / 0.55);
        ">
          <div style="
            font-weight: 800;
            font-size: 14px;
            text-align: center;
            color: ${signColor};
          ">${escapeHtml(r.sign)}</div>

          <div style="
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.5;
            color: hsl(var(--foreground));
            overflow-wrap: anywhere;
          ">${escapeHtml(r.u)}</div>

          <div style="
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.5;
            color: hsl(var(--foreground));
            overflow-wrap: anywhere;
          ">${escapeHtml(r.dv)}</div>
        </div>
      `;
    })
    .join('');

  return `
    <div style="
      margin: 12px 0;
      padding: 14px 14px;
      border-radius: 14px;
      border: 1px solid hsl(var(--border) / 0.7);
      background: hsl(var(--surface-elevated));
      box-shadow: 0 1px 0 hsl(var(--border) / 0.25) inset;
      overflow: hidden;
    ">
      <div style="
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.10em;
        text-transform: uppercase;
        color: hsl(var(--primary));
        margin-bottom: 10px;
        opacity: 0.85;
      ">IBP TABULAR SETUP</div>

      <div style="
        border-radius: 12px;
        border: 1px solid hsl(var(--border) / 0.55);
        background: hsl(var(--background) / 0.55);
        overflow: hidden;
      ">
        <div style="
          display: grid;
          grid-template-columns: 60px 1fr 1.6fr;
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          color: hsl(var(--muted-foreground));
        ">
          <div style="text-align:center;">sign</div>
          <div>u</div>
          <div>dv</div>
        </div>
        ${rowHtml}
      </div>
    </div>
  `;
}

function renderCodeCard(codeRaw: string): string {
  const code = String(codeRaw ?? '').trim();

  // If it looks like the IBP ascii table, render a pretty table.
  const parsed = parseIbpAsciiTable(code);
  if (parsed) {
    return renderIbpPrettyTable(parsed.rows);
  }

  // Otherwise: normal code card.
  return `
    <div style="
      margin: 12px 0;
      padding: 14px 14px;
      border-radius: 14px;
      border: 1px solid hsl(var(--border) / 0.7);
      background: hsl(var(--surface-elevated));
      box-shadow: 0 1px 0 hsl(var(--border) / 0.25) inset;
      overflow: hidden;
    ">
      <pre style="
        margin: 0;
        padding: 12px 12px;
        border-radius: 12px;
        border: 1px solid hsl(var(--border) / 0.55);
        background: hsl(var(--background) / 0.55);
        overflow-x: auto;
        font-size: 14px;
        line-height: 1.6;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
        white-space: pre;
      "><code>${escapeHtml(code)}</code></pre>
    </div>
  `;
}

function renderMathContent(content: string): string {
  let processed = content ?? '';

  // 1) Extract fenced code blocks FIRST
  const codeBlocks: string[] = [];
  processed = processed.replace(/```([\s\S]*?)```/g, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(String(code ?? ''));
    return `@@CODEBLOCK_${idx}@@`;
  });

  // 2) KaTeX rendering (non-code only)
  processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    try {
      return `<div class="katex-display">${katex.renderToString(String(math).trim(), {
        displayMode: true,
        throwOnError: false,
      })}</div>`;
    } catch {
      return `<code>${escapeHtml(String(math))}</code>`;
    }
  });

  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    try {
      return `<div class="katex-display">${katex.renderToString(String(math).trim(), {
        displayMode: true,
        throwOnError: false,
      })}</div>`;
    } catch {
      return `<code>${escapeHtml(String(math))}</code>`;
    }
  });

  processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => {
    try {
      return katex.renderToString(String(math).trim(), {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      return `<code>${escapeHtml(String(math))}</code>`;
    }
  });

  processed = processed.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
    try {
      return katex.renderToString(String(math).trim(), {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      return `<code>${escapeHtml(String(math))}</code>`;
    }
  });

  // Bold **text**
  processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Newlines -> <br>
  processed = processed.replace(/\n/g, '<br>');

  // 3) Put code blocks back at the end
  processed = processed.replace(/@@CODEBLOCK_(\d+)@@/g, (_, nStr) => {
    const n = Number(nStr);
    const code = codeBlocks[n] ?? '';
    return renderCodeCard(code);
  });

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
      <div
        className={`
          w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
          ${isUser ? 'bg-secondary border border-border' : 'bg-primary/12 border border-primary/20'}
        `}
      >
        {isUser ? (
          <User className="w-4 h-4 text-muted-foreground" />
        ) : (
          <Bot className="w-4 h-4 text-primary" />
        )}
      </div>

      {/* Message Content */}
      <div className={`flex-1 max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Role Label */}
        <p
          className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 px-0.5 ${
            isUser ? 'text-right text-muted-foreground/60' : 'text-left text-primary/60'
          }`}
        >
          {isUser ? 'You' : 'Professor Woody AI Clone'}
        </p>

        <div
          className={`
            rounded-xl px-4 py-3 message-content
            ${
              isUser
                ? 'bg-secondary border border-border text-secondary-foreground rounded-tr-sm'
                : 'bg-surface-elevated border border-border/60 text-foreground rounded-tl-sm'
            }
          `}
          style={{
            backgroundColor: isUser ? undefined : 'hsl(var(--surface-elevated))',
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
        <p
          className={`text-[9px] font-medium text-muted-foreground/50 mt-1.5 px-0.5 tracking-wide ${
            isUser ? 'text-right' : 'text-left'
          }`}
        >
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </motion.div>
  );
});
