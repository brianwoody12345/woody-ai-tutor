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
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

type ParsedIbpRow = { sign: string; u: string; dv: string };

function normalizeSign(raw: string): string {
  const s = String(raw ?? '').trim();
  if (s === '+') return '+';
  // Accept common unicode dashes/minus and normalize to '-'
  if (s === '-' || s === '−' || s === '–' || s === '—') return '-';
  return '';
}

function stripMathDelimiters(s: string): string {
  const t = String(s ?? '').trim();
  if (t.startsWith('$$') && t.endsWith('$$')) return t.slice(2, -2).trim();
  if (t.startsWith('$') && t.endsWith('$')) return t.slice(1, -1).trim();
  return t;
}

function renderLatexOrText(raw: string, opts?: { color?: string; displayMode?: boolean }): string {
  const color = opts?.color;
  const displayMode = !!opts?.displayMode;

  const tex = stripMathDelimiters(raw);

  // Attempt KaTeX on anything that looks math-ish; fallback to text.
  const looksMath =
    /\\[a-zA-Z]+/.test(tex) ||
    /[_^{}]/.test(tex) ||
    /[=()]/.test(tex) ||
    /sin|cos|tan|sec|csc|cot|ln|log|exp|dx|e\^/i.test(tex);

  if (!looksMath) {
    const safe = escapeHtml(raw);
    return color ? `<span style="color:${color};">${safe}</span>` : safe;
  }

  try {
    const html = katex.renderToString(tex, { throwOnError: false, displayMode });
    return color ? `<span style="color:${color};">${html}</span>` : html;
  } catch {
    const safe = escapeHtml(raw);
    return color ? `<span style="color:${color};">${safe}</span>` : safe;
  }
}

function isMarkdownSeparatorLine(line: string): boolean {
  // Matches lines like: |---|---|---| or ---|---|---
  const l = line.replace(/\s/g, '');
  return /^(\|?-{3,}\|)+-?\|?$/.test(l);
}

function parseIbpTableFromCode(codeRaw: string): { rows: ParsedIbpRow[] } | null {
  const code = String(codeRaw ?? '').trim();
  const lines = code.split('\n').map((l) => l.trim()).filter(Boolean);

  // Accept header formats:
  // 1) "sign | u | dv"
  // 2) "sign   u   dv" (spaces)
  const headerIdx = lines.findIndex((l) =>
    /^sign(\s+|\s*\|\s*)u(\s+|\s*\|\s*)dv$/i.test(l)
  );
  if (headerIdx === -1) return null;

  const dataLines = lines.slice(headerIdx + 1);

  const rows: ParsedIbpRow[] = [];

  for (const l0 of dataLines) {
    const l = l0.trim();
    if (!l) continue;
    if (isMarkdownSeparatorLine(l)) continue;

    let sign = '';
    let u = '';
    let dv = '';

    if (l.includes('|')) {
      // Pipe table row
      const parts = l
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);

      if (parts.length >= 3) {
        sign = normalizeSign(parts[0]);
        u = parts[1] ?? '';
        dv = parts.slice(2).join(' | ');
      }
    } else {
      // Space-separated columns (2+ spaces)
      const parts = l.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        sign = normalizeSign(parts[0]);
        u = parts[1] ?? '';
        dv = parts.slice(2).join(' ');
      }
    }

    if (!sign || !u || !dv) continue;
    rows.push({ sign, u, dv });

    if (rows.length >= 6) break;
  }

  if (rows.length >= 2) return { rows };
  return null;
}

function renderIbpPrettyTable(rows: ParsedIbpRow[]): string {
  const rows3 = rows.slice(0, 3);

  const rowHtml = rows3
    .map((r) => {
      const signColor =
        r.sign === '+'
          ? 'hsl(var(--primary))'
          : 'hsl(var(--destructive, 0 84% 60%))';

      const uHtml = renderLatexOrText(r.u);
      const dvHtml = renderLatexOrText(r.dv, { color: '#1dd3c5' });

      return `
        <div style="
          display: grid;
          grid-template-columns: 60px 1fr 1.6fr;
          gap: 10px;
          align-items: center;
          padding: 12px 12px;
          border-top: 1px solid hsl(var(--border) / 0.55);
          position: relative;
          z-index: 2;
        ">
          <div style="
            font-weight: 900;
            font-size: 14px;
            text-align: center;
            color: ${signColor};
          ">${escapeHtml(r.sign)}</div>

          <div style="
            font-size: 14px;
            line-height: 1.6;
            color: hsl(var(--foreground));
            overflow-wrap: anywhere;
          ">${uHtml}</div>

          <div style="
            font-size: 14px;
            line-height: 1.6;
            overflow-wrap: anywhere;
          ">${dvHtml}</div>
        </div>
      `;
    })
    .join('');

  // SVG overlay arrows (green diagonals + red straight across)
  const arrowsSvg = `
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style="
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
      opacity: 0.95;
    ">
      <defs>
        <marker id="arrowG" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#37b24d"></path>
        </marker>
        <marker id="arrowR" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#ff3b3b"></path>
        </marker>
      </defs>

      <!-- green diagonals: between u and dv columns -->
      <path d="M 56 36 L 68 52" stroke="#37b24d" stroke-width="2.5" fill="none" marker-end="url(#arrowG)"></path>
      <path d="M 56 57 L 68 73" stroke="#37b24d" stroke-width="2.5" fill="none" marker-end="url(#arrowG)"></path>

      <!-- red straight-across near bottom -->
      <path d="M 36 94 L 92 94" stroke="#ff3b3b" stroke-width="3" fill="none" marker-end="url(#arrowR)"></path>
    </svg>
  `;

  return `
    <div style="
      margin: 12px 0;
      padding: 14px 14px;
      border-radius: 14px;
      border: 1px solid hsl(var(--border) / 0.7);
      background: hsl(var(--surface-elevated));
      box-shadow: 0 1px 0 hsl(var(--border) / 0.25) inset;
      overflow: hidden;
      position: relative;
    ">
      <div style="
        font-size: 11px;
        font-weight: 900;
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
        position: relative;
      ">
        ${arrowsSvg}

        <div style="
          display: grid;
          grid-template-columns: 60px 1fr 1.6fr;
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          color: hsl(var(--muted-foreground));
          position: relative;
          z-index: 2;
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

  // If it looks like the IBP table, pretty render it.
  const parsed = parseIbpTableFromCode(code);
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
