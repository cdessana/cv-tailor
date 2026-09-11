/**
 * @file notifications.js
 * @description Centralized alert, notification, and terminal logging service.
 */

export function showParserAlert(message, type = "info") {
  const box = document.querySelector("#parser-alert");
  if (!box) return;
  box.innerHTML = message;
  box.classList.remove("hidden");
  if (type === "error") {
    box.className = "p-3.5 rounded-lg border text-xs bg-rose-50 text-rose-800 border-rose-200 leading-relaxed";
  } else if (type === "warning") {
    box.className = "p-3.5 rounded-lg border text-xs bg-amber-50 text-amber-900 border-amber-200 leading-relaxed";
  } else {
    box.className = "p-3.5 rounded-lg border text-xs bg-slate-50 text-slate-800 border-slate-200 leading-relaxed";
  }
}

export function hideParserAlert() {
  const box = document.querySelector("#parser-alert");
  if (box) box.classList.add("hidden");
}

export function appendTerminalLog(message) {
  const terminal = document.querySelector("#pipeline-terminal-output");
  if (!terminal) return;
  const line = document.createElement("div");
  line.className = "py-0.5 font-mono text-[11px] text-slate-300 leading-normal";
  line.textContent = message;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}
