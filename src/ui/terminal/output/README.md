# SOBA TUI Implementation

This directory contains the implementation of the SOBA TUI (Text User Interface) as specified in the [TUI Design Document](/internal-design-notes).

## Implementation Status

All components from the design document have been implemented:

- [x] ANSI escape code system (`colors.ts`)
- [x] Theme system with dark/light mode (`theme.ts`)
- [x] Block rendering (`blocks.ts`)
- [x] Diff rendering (`diff.ts`)
- [x] Status bar (`status-bar.ts`)
- [x] Event-driven renderer (`renderer.ts`)
- [x] Spinner for waiting states (`spinner.ts`)

## Key Features Implemented

- Zero dependencies (no React, Blessed, or Chalk)
- 15 semantic color tokens as specified
- Event-driven architecture
- Line-buffered output for minimal redraws
- Streaming output for agent responses
- Clean block-based layout with proper indentation
- Status bar with token usage indicator

## Enhancements Beyond Initial Design

- Improved thinking state visualization in agent header
- Enhanced diff rendering with better indentation and formatting
- Better token formatting in status bar
- Added new theme tokens for thinking indicators

## Architecture

The TUI follows the architecture specified in the design document:

```
Agent Loop → TUI Renderer → Terminal
```

The renderer consumes typed events and renders the appropriate TUI components.

## Color System

The color system uses the 15 semantic tokens specified in the design document, with values inspired by the pi-agent dark theme but simplified for easier configuration.
