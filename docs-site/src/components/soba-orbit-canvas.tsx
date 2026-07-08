"use client";

import { useEffect, useRef } from "react";

type Point3D = {
  x: number;
  y: number;
  z: number;
};

type OrbitNode = Point3D & {
  label: string;
  short: string;
  radius: number;
  speed: number;
  phase: number;
};

const NODES: OrbitNode[] = [
  { label: "Session Tree", short: "JSONL", x: -170, y: -58, z: 30, radius: 150, speed: 0.42, phase: 0.2 },
  { label: "Proof Receipts", short: ".json", x: 142, y: -84, z: -40, radius: 175, speed: 0.34, phase: 1.8 },
  { label: "Skill Lab", short: "bench", x: 188, y: 66, z: 36, radius: 142, speed: 0.5, phase: 3.1 },
  { label: "Tools", short: "checks", x: -128, y: 98, z: -76, radius: 160, speed: 0.38, phase: 4.3 },
  { label: "Permissions", short: "receipts", x: 42, y: 150, z: 94, radius: 132, speed: 0.45, phase: 5.2 },
  { label: "MCP", short: "stdio", x: 8, y: -162, z: 102, radius: 168, speed: 0.47, phase: 2.55 },
  { label: "Project Memory", short: "provenance", x: -206, y: 34, z: 118, radius: 128, speed: 0.31, phase: 5.85 },
];

const CONNECTIONS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [0, 4],
  [1, 4],
  [2, 4],
  [3, 4],
  [5, 2],
  [5, 3],
  [6, 0],
  [6, 1],
  [6, 4],
];

function rotate(point: Point3D, yaw: number, pitch: number): Point3D {
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosX = Math.cos(pitch);
  const sinX = Math.sin(pitch);

  const x = point.x * cosY - point.z * sinY;
  const z = point.x * sinY + point.z * cosY;
  const y = point.y * cosX - z * sinX;
  const zz = point.y * sinX + z * cosX;

  return { x, y, z: zz };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function cssColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export function SobaOrbitCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { x: 0, y: 0 };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let frame = 0;
    let animationId = 0;
    let lastTime = 0;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      width = rect?.width ?? 900;
      height = rect?.height ?? 620;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const project = (point: Point3D) => {
      const distance = 680;
      const scale = distance / (distance - point.z);
      return {
        x: width / 2 + point.x * scale,
        y: height / 2 + point.y * scale,
        scale,
        depth: point.z,
      };
    };

    const drawGrid = (primary: string, border: string) => {
      const horizon = height * 0.62;
      ctx.save();
      ctx.translate(width / 2, horizon);
      ctx.rotate(-0.02 + pointer.x * 0.02);
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.42;

      for (let i = -12; i <= 12; i++) {
        const x = i * 34;
        ctx.beginPath();
        ctx.moveTo(x * 0.28, -70);
        ctx.lineTo(x * 2.8, height * 0.48);
        ctx.stroke();
      }

      for (let i = 0; i < 9; i++) {
        const y = i * i * 5 + 8;
        ctx.globalAlpha = Math.max(0.06, 0.36 - i * 0.03);
        ctx.beginPath();
        ctx.moveTo(-width * 0.55 - i * 28, y);
        ctx.lineTo(width * 0.55 + i * 28, y);
        ctx.stroke();
      }

      const gradient = ctx.createLinearGradient(0, -70, 0, height * 0.4);
      gradient.addColorStop(0, "transparent");
      gradient.addColorStop(0.55, primary);
      gradient.addColorStop(1, "transparent");
      ctx.strokeStyle = gradient;
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.moveTo(0, -78);
      ctx.lineTo(0, height * 0.42);
      ctx.stroke();
      ctx.restore();
    };

    const draw = (time: number) => {
      const delta = time - lastTime;
      lastTime = time;
      if (!reduceMotion.matches) frame += delta * 0.001;

      const isDark = document.documentElement.classList.contains("dark");
      const background = cssColor("--color-fd-background", isDark ? "hsl(220, 17%, 7%)" : "#F7F7F2");
      const foreground = cssColor("--color-fd-foreground", isDark ? "hsl(215, 18%, 87%)" : "#171717");
      const primary = cssColor("--color-fd-primary", isDark ? "hsl(214, 17%, 73%)" : "#244C66");
      const muted = cssColor("--color-fd-muted", isDark ? "hsl(220, 16%, 11%)" : "#ECEBE3");
      const border = cssColor("--color-fd-border", isDark ? "hsl(217, 16%, 22%)" : "#D5D2C6");
      const mutedForeground = cssColor(
        "--color-fd-muted-foreground",
        isDark ? "hsl(215, 9%, 53%)" : "#5E625C",
      );

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      const glow = ctx.createRadialGradient(
        width * 0.55,
        height * 0.42,
        10,
        width * 0.55,
        height * 0.42,
        Math.max(width, height) * 0.58,
      );
      glow.addColorStop(0, isDark ? "rgba(180, 196, 215, 0.2)" : "rgba(58, 89, 112, 0.18)");
      glow.addColorStop(0.38, isDark ? "rgba(180, 196, 215, 0.055)" : "rgba(58, 89, 112, 0.06)");
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      drawGrid(primary, border);

      const yaw = frame * 0.38 + pointer.x * 0.45;
      const pitch = -0.32 + pointer.y * 0.2;
      const centerPulse = 1 + Math.sin(frame * 2.1) * 0.035;

      const points = NODES.map((node, index) => {
        const angle = frame * node.speed + node.phase;
        const orbital: Point3D = {
          x: node.x + Math.cos(angle) * node.radius * 0.28,
          y: node.y + Math.sin(angle * 0.8 + index) * 24,
          z: node.z + Math.sin(angle) * node.radius * 0.44,
        };
        return { node, projected: project(rotate(orbital, yaw, pitch)) };
      });

      CONNECTIONS.forEach(([from, to]) => {
        const a = points[from]?.projected;
        const b = points[to]?.projected;
        if (!a || !b) return;
        const alpha = Math.max(0.16, Math.min(0.52, (a.scale + b.scale - 1.55) * 0.7));
        ctx.strokeStyle = primary;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = Math.max(1, (a.scale + b.scale) * 0.75);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      const core = project(rotate({ x: 0, y: 0, z: 0 }, yaw, pitch));
      const coreRadius = 58 * centerPulse;
      const coreGradient = ctx.createRadialGradient(core.x - 16, core.y - 18, 8, core.x, core.y, coreRadius * 1.55);
      coreGradient.addColorStop(0, foreground);
      coreGradient.addColorStop(0.36, primary);
      coreGradient.addColorStop(1, isDark ? "rgba(180, 196, 215, 0.02)" : "rgba(58, 89, 112, 0.02)");

      ctx.shadowColor = isDark ? "rgba(180, 196, 215, 0.32)" : "rgba(58, 89, 112, 0.24)";
      ctx.shadowBlur = 35;
      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(core.x, core.y, coreRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      for (let ring = 0; ring < 3; ring++) {
        ctx.save();
        ctx.translate(core.x, core.y);
        ctx.rotate(frame * (0.22 + ring * 0.05) + ring);
        ctx.scale(1, 0.34 + ring * 0.1);
        ctx.strokeStyle = primary;
        ctx.globalAlpha = 0.24 - ring * 0.04;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, coreRadius * (1.35 + ring * 0.42), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = isDark ? "hsl(220, 17%, 7%)" : "hsl(39, 41%, 93%)";
      ctx.font = "700 16px Inter, ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.fillText("SOBA", core.x, core.y - 3);
      ctx.font = "11px Inter, ui-sans-serif, system-ui";
      ctx.fillText("agent core", core.x, core.y + 15);
      ctx.textAlign = "left";

      points
        .sort((a, b) => a.projected.depth - b.projected.depth)
        .forEach(({ node, projected }) => {
          const r = Math.max(34, 44 * projected.scale);
          ctx.shadowColor = "rgba(0, 0, 0, 0.18)";
          ctx.shadowBlur = 20 * projected.scale;
          ctx.fillStyle = muted;
          ctx.globalAlpha = Math.max(0.72, Math.min(0.98, projected.scale));
          roundedRect(ctx, projected.x - r * 1.28, projected.y - r * 0.64, r * 2.56, r * 1.28, 16);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = projected.depth > 0 ? primary : border;
          ctx.lineWidth = projected.depth > 0 ? 1.5 : 1;
          ctx.stroke();

          ctx.globalAlpha = 1;
          ctx.fillStyle = foreground;
          ctx.font = `700 ${Math.max(10, 12 * projected.scale)}px Inter, ui-sans-serif, system-ui`;
          ctx.textAlign = "center";
          ctx.fillText(node.label, projected.x, projected.y - 3 * projected.scale);
          ctx.fillStyle = mutedForeground;
          ctx.font = `${Math.max(9, 10 * projected.scale)}px "SF Mono", "JetBrains Mono", Consolas, monospace`;
          ctx.fillText(node.short, projected.x, projected.y + 16 * projected.scale);
          ctx.textAlign = "left";
        });

      animationId = requestAnimationFrame(draw);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    };

    resize();
    animationId = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />;
}
