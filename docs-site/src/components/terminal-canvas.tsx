"use client";

import { useEffect, useRef } from "react";
import { APP_VERSION_LABEL } from "@/lib/version";

interface TerminalLine {
  text: string;
  type: "prompt" | "output" | "command" | "tree";
  delay: number;
}

const SESSION_LINES: TerminalLine[] = [
  { text: '$ soba "Fix parser failures and leave proof"', type: "command", delay: 600 },
  { text: `soba ${APP_VERSION_LABEL} — session a1b2c3d4  [Graphite]`, type: "output", delay: 400 },
  { text: "agent: read package.json, parser tests, and Project Memory", type: "output", delay: 450 },
  { text: "tool: edit src/parser.ts  (+18/-9)", type: "output", delay: 350 },
  { text: "check: bun test tests/parser.test.ts  ✓ passed", type: "output", delay: 350 },
  { text: "check: bunx tsc --noEmit --pretty false  ✓ passed", type: "output", delay: 350 },
  { text: "proof: .soba/evidence/2026-07-08-parser.soba-proof.json", type: "output", delay: 450 },
  { text: "claims: 3 supported  •  risks: 1 documented  •  permissions: 4 receipts", type: "output", delay: 350 },
  { text: "soba> /session", type: "prompt", delay: 500 },
  { text: "Session: a1b2c3d4 (v2) — 22 entries \u2022 4,810 effective tokens", type: "output", delay: 350 },
  { text: "soba> /skill bench fix-until-green", type: "prompt", delay: 600 },
  { text: "runs: 24  \u2022  success: 79%  \u2022  common failure: broad suite too early", type: "output", delay: 350 },
  { text: "soba> !soba memory doctor", type: "prompt", delay: 600 },
  { text: "memory: 18 fresh facts  \u2022  2 stale  \u2022  verified=false", type: "output", delay: 350 },
  { text: "soba> /permissions", type: "prompt", delay: 500 },
  { text: "Permission mode: ask  \u2022  last risky command used repo-scoped receipt", type: "output", delay: 350 },
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
        bg: isDark ? "hsl(220, 14%, 8%)" : "#F7F7F2",
        terminalBg: isDark ? "hsl(220, 14%, 10%)" : "#ECEBE3",
        border: isDark ? "hsl(220, 12%, 20%)" : "#D5D2C6",
        text: isDark ? "hsl(214, 17%, 82%)" : "#244C66",
        prompt: isDark ? "hsl(150, 60%, 45%)" : "#3F7052",
        command: isDark ? "hsl(214, 17%, 90%)" : "#171717",
        output: isDark ? "hsl(214, 10%, 60%)" : "#5E625C",
        tree: isDark ? "hsl(200, 30%, 55%)" : "#6B4E71",
        success: isDark ? "hsl(140, 60%, 50%)" : "#3F7052",
        cursor: isDark ? "hsl(214, 17%, 82%)" : "#244C66",
        scanline: isDark ? "rgba(0,0,0,0.03)" : "rgba(0,0,0,0.015)",
        glow: isDark ? "rgba(100, 160, 255, 0.03)" : "rgba(60, 120, 200, 0.02)",
        header: isDark ? "hsl(220, 12%, 18%)" : "#D5D2C6",
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
