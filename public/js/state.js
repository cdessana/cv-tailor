/**
 * @file state.js
 * @description Centralized application state management.
 */

export const state = {
  currentJob: null,
  currentJobPath: null,
  currentAnalysis: null,
  currentRun: null,
  config: null,
  savedJobs: [],
  doctorStatus: null,
};

export function setState(newState) {
  Object.assign(state, newState);
}

export function resetState() {
  state.currentJob = null;
  state.currentJobPath = null;
  state.currentAnalysis = null;
  state.currentRun = null;
}
