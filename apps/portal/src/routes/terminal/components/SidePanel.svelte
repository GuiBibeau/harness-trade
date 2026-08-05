<script lang="ts">
  // Dock shell — presentation lives in AgentChat (shared with full-page).
  import { onDestroy } from "svelte";
  import AgentSurface from "./AgentSurface.svelte";

  let {
    buildContext,
    onRequestAuth,
    accountMode = "paper",
    dockWidth,
    minDockWidth,
    maxDockWidth,
    focusComposerRequest = 0,
    onDockResize,
    onDockResizeEnd,
  }: {
    buildContext: () => Record<string, unknown>;
    onRequestAuth: () => void;
    accountMode?: "live" | "paper";
    dockWidth: number;
    minDockWidth: number;
    maxDockWidth: number;
    focusComposerRequest?: number;
    onDockResize: (width: number) => void;
    onDockResizeEnd: (width: number) => void;
  } = $props();

  let resizeHandle: HTMLDivElement | undefined = $state();
  let resizing = $state(false);
  let expanded = $state(false);

  function expand(): void {
    expanded = true;
  }

  function collapse(): void {
    expanded = false;
  }

  function onGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && expanded) collapse();
  }

  function startResize(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    resizing = true;
    resizeHandle?.setPointerCapture(event.pointerId);
    document.body.classList.add("agent-dock-resizing");
  }

  function resize(event: PointerEvent): void {
    if (!resizing) return;
    onDockResize(window.innerWidth - event.clientX);
  }

  function finishResize(event?: PointerEvent): void {
    if (!resizing) return;
    resizing = false;
    document.body.classList.remove("agent-dock-resizing");
    const finalWidth = event ? window.innerWidth - event.clientX : dockWidth;
    onDockResize(finalWidth);
    onDockResizeEnd(finalWidth);
    if (event && resizeHandle?.hasPointerCapture(event.pointerId)) {
      resizeHandle.releasePointerCapture(event.pointerId);
    }
  }

  function cancelResize(): void {
    if (!resizing) return;
    resizing = false;
    document.body.classList.remove("agent-dock-resizing");
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    const step = event.shiftKey ? 32 : 16;
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = dockWidth + step;
    if (event.key === "ArrowRight") nextWidth = dockWidth - step;
    if (event.key === "Home") nextWidth = minDockWidth;
    if (event.key === "End") nextWidth = maxDockWidth;
    if (nextWidth === null) return;
    event.preventDefault();
    onDockResize(nextWidth);
    onDockResizeEnd(nextWidth);
  }

  onDestroy(() => {
    if (typeof document !== "undefined") {
      document.body.classList.remove("agent-dock-resizing");
    }
  });
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<div class="agent-panel" class:expanded>
  {#if !expanded}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={resizeHandle}
      class="dock-resizer"
      class:active={resizing}
      role="separator"
      aria-label="Resize agent dock"
      aria-orientation="vertical"
      aria-valuemin={minDockWidth}
      aria-valuemax={maxDockWidth}
      aria-valuenow={Math.round(dockWidth)}
      tabindex="0"
      title="Drag to resize agent dock"
      onpointerdown={startResize}
      onpointermove={resize}
      onpointerup={finishResize}
      onpointercancel={cancelResize}
      onlostpointercapture={cancelResize}
      onkeydown={resizeWithKeyboard}
    >
      <span aria-hidden="true"></span>
    </div>
  {/if}

  <AgentSurface
    {buildContext}
    {onRequestAuth}
    {accountMode}
    {focusComposerRequest}
    layout={expanded ? "page" : "dock"}
    onExpand={expand}
    onCollapse={collapse}
  />
</div>

<style>
  .agent-panel {
    display: contents;
  }

  .agent-panel.expanded {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    background: var(--surface);
  }

  .dock-resizer {
    position: fixed;
    top: var(--topbar-h, 3rem);
    right: calc(var(--agent-dock-w, 28rem) - 0.3rem);
    z-index: 27;
    width: 0.6rem;
    height: calc(
      100dvh - var(--topbar-h, 3rem) - var(--status-h, 1.9rem)
    );
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    cursor: col-resize;
    touch-action: none;
  }

  .dock-resizer span {
    width: 1px;
    height: 100%;
    background: var(--line);
    transition:
      width 120ms ease,
      background-color 120ms ease;
  }

  .dock-resizer:hover span,
  .dock-resizer:focus-visible span,
  .dock-resizer.active span {
    width: 3px;
    background: var(--accent);
  }

  .dock-resizer:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -2px;
  }

  :global(body.agent-dock-resizing) {
    cursor: col-resize;
    user-select: none;
  }

  @media (max-width: 1100px) {
    .dock-resizer {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dock-resizer span {
      transition: none;
    }
  }
</style>
