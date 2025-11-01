export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => Array.from(document.querySelectorAll(selector));
export const uid = () => `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
