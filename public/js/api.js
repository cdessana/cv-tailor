/**
 * @file api.js
 * @description Centralized API client wrapper for backend communication.
 */

export async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
    return res;
  } catch (err) {
    console.error(`API Error [${url}]:`, err);
    throw err;
  }
}

export async function fetchJson(url, options = {}) {
  const res = await apiFetch(url, options);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}
