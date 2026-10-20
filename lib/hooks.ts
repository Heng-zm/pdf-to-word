"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Track a CSS media query. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * The width of an element, tracked with a ResizeObserver.
 *
 * The element may only appear later (the preview is rendered once a document
 * has been recognised), so a callback ref is used instead of an effect that
 * runs once on mount.
 */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  const setRef = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) {
      setWidth(0);
      return;
    }
    const next = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    next.observe(node);
    observer.current = next;
    setWidth(node.getBoundingClientRect().width);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [setRef, width];
}

/** Run a callback when a keyboard shortcut is pressed. */
export function useHotkey(
  combo: { key: string; meta?: boolean; ctrl?: boolean; shift?: boolean },
  handler: (event: KeyboardEvent) => void,
) {
  const saved = useRef(handler);
  saved.current = handler;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== combo.key.toLowerCase()) return;
      if (combo.meta && !(event.metaKey || event.ctrlKey)) return;
      if (combo.ctrl && !event.ctrlKey) return;
      if (combo.shift && !event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      saved.current(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [combo.key, combo.meta, combo.ctrl, combo.shift]);
}

/** Copy text to the clipboard, falling back to a hidden textarea. */
export function useCopy(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback((value: string) => {
    const done = () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(() => undefined);
      return;
    }
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      done();
    } catch {
      /* ignore */
    }
    area.remove();
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return [copied, copy];
}
