"use client";

import { useEffect, useRef } from "react";

interface TerminalLine {
  text: string;
  type: "prompt" | "output" | "command" | "tree";
  delay: number;
}

const SESSION_LINES: TerminalLine[] = [
  { text: '$ soba "Add OAuth 2.0 support to the API"', type: "command", delay: 600 },
  { text: "soba v0.4.1 — session a1b2c3d4  [Graphite]", type: "output", delay: 400 },
  { text: "soba> /session", type: "prompt", delay: 500 },
  { text: "Session: a1b2c3d4 (v2) — 14 entries \u2022 3,240 effective tokens", type: "output", delay: 350 },
  { text: "soba> /skill list", type: "prompt", delay: 600 },
  { text: "git-summary v3  \u2022  lint-fix v2", type: "output", delay: 150 },
  { text: "version-bump v1  \u2022  commit-message v1", type: "output", delay: 130 },
  { text: "pr-description v1  \u2022  bug-fixer v1  (bundled)", type: "output", delay: 130 },
  { text: "soba> /compact", type: "prompt", delay: 600 },
  { text: "Compacting... \u2713  8,472 \u2192 3,124 tokens (63% reclaimed)", type: "output", delay: 400 },
  { text: "soba> /lang ru", type: "prompt", delay: 500 },
  {
    text: "\u042f\u0437\u044b\u043a \u0438\u0437\u043c\u0435\u043d\u0451\u043d \u043d\u0430: ru",
    type: "output",
    delay: 350,
  },
  { text: "soba> /config", type: "prompt", delay: 500 },
  { text: "model: openai/gpt-4o  \u2022  context: 128K  \u2022  max output: 16384", type: "output", delay: 350 },
  { text: "soba> /theme paper", type: "prompt", delay: 500 },
  { text: "Theme changed to: paper (light)", type: "output", delay: 350 },
  { text: "soba> /capsule", type: "prompt", delay: 500 },
  {
    text: "a7f3c   aggressive  0.87  \u2022  b2e8d   safe  0.94  \u2022  e441f   summary  0.72",
    type: "output",
    delay: 350,
  },
  { text: "soba> /budget", type: "prompt", delay: 400 },
  { text: "Used: 3.1K / 128K tokens (2.4%)", type: "output", delay: 300 },
  { text: "soba> _", type: "prompt", delay: 0 },
];

export function TerminalCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let w = 0;
    let h = 0;
    let animId = 0;

    // Animation state
    let currentLine = 0;
    let charIndex = 0;
    let lineTimer = 0;
    let blinkTimer = 0;
    let cursorVisible = true;
    let lastTime = 0;
    const typingSpeed = 35; // ms per char
    const blinkInterval = 530;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      w = rect?.width ?? window.innerWidth;
      h = rect?.height ?? 560;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const getThemeColors = () => {
      const isDark = document.documentElement.classList.contains("dark");
      return {
        isDark,
        bg: isDark ? "hsl(220, 14%, 8%)" : "hsl(210, 20%, 96%)",
        terminalBg: isDark ? "hsl(220, 14%, 10%)" : "hsl(210, 20%, 98%)",
        border: isDark ? "hsl(220, 12%, 20%)" : "hsl(210, 15%, 88%)",
        text: isDark ? "hsl(214, 17%, 82%)" : "hsl(209, 25%, 30%)",
        prompt: isDark ? "hsl(150, 60%, 45%)" : "hsl(150, 55%, 38%)",
        command: isDark ? "hsl(214, 17%, 90%)" : "hsl(209, 25%, 20%)",
        output: isDark ? "hsl(214, 10%, 60%)" : "hsl(209, 15%, 50%)",
        tree: isDark ? "hsl(200, 30%, 55%)" : "hsl(200, 30%, 45%)",
        success: isDark ? "hsl(140, 60%, 50%)" : "hsl(140, 55%, 40%)",
        cursor: isDark ? "hsl(214, 17%, 82%)" : "hsl(209, 25%, 30%)",
        scanline: isDark ? "rgba(0,0,0,0.03)" : "rgba(0,0,0,0.015)",
        glow: isDark ? "rgba(100, 160, 255, 0.03)" : "rgba(60, 120, 200, 0.02)",
        header: isDark ? "hsl(220, 12%, 18%)" : "hsl(210, 15%, 92%)",
        dotRed: "hsl(0, 80%, 60%)",
        dotYellow: "hsl(45, 90%, 50%)",
        dotGreen: "hsl(140, 70%, 45%)",
      };
    };

    const getCharWidth = (fontSize: number) => {
      ctx.font = `${fontSize}px "SF Mono", "Fira Code", "JetBrains Mono", "Cascadia Code", Consolas, monospace`;
      return ctx.measureText("M").width;
    };

    const draw = (time: number) => {
      const dt = time - lastTime;
      lastTime = time;

      const colors = getThemeColors();
      const fontSize = Math.max(11, Math.min(16, w / 55));
      const charW = getCharWidth(fontSize);
      const lineH = fontSize * 1.6;
      const termPadX = Math.max(16, w * 0.04);
      const termPadY = 16;
      const headerH = 32;

      // Terminal dimensions — edge-to-edge
      const termW = w;
      const termX = 0;
      const contentW = termW - termPadX * 2;
      const maxChars = Math.floor(contentW / charW);

      // Clear
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      // Background glow
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6);
      grad.addColorStop(0, colors.glow);
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Terminal window — positioned at the top, no gap above
      const termY = 0;
      const termH = SESSION_LINES.length * lineH + headerH + termPadY * 2 + 8;

      // Terminal body (edge-to-edge, no rounded corners)
      ctx.fillStyle = colors.terminalBg;
      ctx.fillRect(termX, termY, termW, termH);

      // Terminal border
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(termX, termY, termW, termH);

      // Header bar
      ctx.fillStyle = colors.header;
      ctx.fillRect(termX + 1, termY + 1, termW - 2, headerH);

      // Header bottom line
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(termX, termY + headerH);
      ctx.lineTo(termX + termW, termY + headerH);
      ctx.stroke();

      // Window dots
      const dotR = 5;
      const dotY = termY + headerH / 2;
      const dots = [colors.dotRed, colors.dotYellow, colors.dotGreen];
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = dots[i];
        ctx.beginPath();
        ctx.arc(termX + 18 + i * 18, dotY, dotR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Title
      ctx.font = `${fontSize - 1}px "SF Mono", "Fira Code", "JetBrains Mono", monospace`;
      ctx.fillStyle = colors.output;
      ctx.textAlign = "center";
      ctx.fillText("soba-agent — zsh", termX + termW / 2, dotY + 4);
      ctx.textAlign = "left";

      // Content clipping
      ctx.save();
      ctx.beginPath();
      ctx.rect(termX + 1, termY + headerH + 1, termW - 2, termH - headerH - 2);
      ctx.clip();

      // Draw lines
      let y = termY + headerH + termPadY + lineH;
      const contentX = termX + termPadX;

      for (let i = 0; i <= currentLine && i < SESSION_LINES.length; i++) {
        const line = SESSION_LINES[i];
        const isCurrentLine = i === currentLine;
        let displayText = line.text;

        if (isCurrentLine) {
          displayText = line.text.slice(0, charIndex);
        }

        // Wrap long lines
        const chunks: string[] = [];
        for (let start = 0; start < displayText.length; start += maxChars) {
          chunks.push(displayText.slice(start, start + maxChars));
        }
        if (chunks.length === 0) chunks.push("");

        for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
          const chunk = chunks[chunkIdx];
          let color = colors.text;

          switch (line.type) {
            case "prompt":
              color = colors.prompt;
              break;
            case "command":
              color = colors.command;
              break;
            case "output":
              if (chunk.includes("✓")) color = colors.success;
              else color = colors.output;
              break;
            case "tree":
              color = colors.tree;
              break;
          }

          // Highlight tree branches
          if (line.type === "tree") {
            for (let ci = 0; ci < chunk.length; ci++) {
              const ch = chunk[ci];
              const cx = contentX + ci * charW;
              if ("│├└─".includes(ch)) {
                ctx.fillStyle = colors.isDark ? "hsl(214, 20%, 45%)" : "hsl(209, 20%, 55%)";
              } else if (ch === "/") {
                ctx.fillStyle = colors.prompt;
              } else {
                ctx.fillStyle = color;
              }
              ctx.fillText(ch, cx, y);
            }
          } else {
            ctx.fillStyle = color;
            ctx.fillText(chunk, contentX, y);
          }

          y += lineH;
        }

        // Cursor on current line
        if (isCurrentLine && cursorVisible && line.type === "prompt") {
          const cursorX = contentX + displayText.length * charW;
          const cursorY = y - lineH + 2;
          ctx.fillStyle = colors.cursor;
          ctx.fillRect(cursorX, cursorY, charW * 0.6, fontSize);
        }
      }

      // Scanlines (CRT effect in dark mode)
      if (colors.isDark) {
        for (let sy = termY + headerH; sy < termY + termH; sy += 3) {
          ctx.fillStyle = colors.scanline;
          ctx.fillRect(termX, sy, termW, 1);
        }
      }

      ctx.restore();

      // Update animation state
      blinkTimer += dt;
      if (blinkTimer > blinkInterval) {
        blinkTimer = 0;
        cursorVisible = !cursorVisible;
      }

      if (currentLine < SESSION_LINES.length) {
        const line = SESSION_LINES[currentLine];
        if (charIndex < line.text.length) {
          lineTimer += dt;
          if (lineTimer > typingSpeed) {
            lineTimer = 0;
            charIndex++;
          }
        } else {
          lineTimer += dt;
          if (lineTimer > line.delay) {
            lineTimer = 0;
            currentLine++;
            charIndex = 0;
          }
        }
      } else {
        // Reset after a pause to loop
        lineTimer += dt;
        if (lineTimer > 4000) {
          lineTimer = 0;
          currentLine = 0;
          charIndex = 0;
        }
      }

      animId = requestAnimationFrame(draw);
    };

    resize();
    animId = requestAnimationFrame(draw);

    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 size-full pointer-events-none" aria-hidden />;
}
