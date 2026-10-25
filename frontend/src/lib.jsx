import { useState, useEffect, useCallback } from 'react';

let token = sessionStorage.getItem('t') || '';
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');
export const setToken = t => { token = t; };

export async function api(path, opts = {}) {
  const r = await fetch(API_BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: opts.body && JSON.stringify(opts.body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error de conexión');
  return r;
}
export const get = async p => (await api(p)).json();
export const money = n => '$' + Number(n || 0).toFixed(2);
export const fdate = d => d ? new Date(d).toLocaleString('es-SV') : '—';

export async function download(path, name, open) {
  const url = URL.createObjectURL(await (await api(path)).blob());
  if (open) return window.open(url);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
}
export async function printPdf(path) {
  const url = URL.createObjectURL(await (await api(path)).blob());
  const fr = Object.assign(document.createElement('iframe'), { src: url });
  fr.style.cssText = 'position:fixed;width:0;height:0;border:0';
  fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { window.open(url); } };
  document.body.appendChild(fr);
}
export function useLoad(path) {
  const [d, setD] = useState(null), [err, setErr] = useState('');
  const load = useCallback(() => {
    setErr('');
    return get(path).then(setD).catch(e => setErr(e.message));
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return [d, load, err];
}
export const Msg = ({ e, ok }) => e ? <div className={ok ? 'okm' : 'err'} role="alert">{e}</div> : null;
