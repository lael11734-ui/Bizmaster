import { useState, useEffect, useRef } from 'react';
import { api, money, download, useLoad, Msg } from './lib.jsx';
import { Login, EnrollBio, InvoiceActions, Users, Purchases, CashExpenses, Finance } from './Extra.jsx';

function Dashboard() {
  const [d, , err] = useLoad('/dashboard');
  if (!d) return <Msg e={err} />;
  const max = Math.max(1, ...d.monthly.map(m => +m.v));
  return <>
    <div className="cards">
      <div className="card"><h4>Ventas de hoy</h4><p>{money(d.today)}</p></div>
      <div className="card"><h4>Ventas del mes</h4><p>{money(d.month)}</p></div>
      <div className="card"><h4>Clientes</h4><p>{d.clients}</p></div>
      <div className="card"><h4>Stock bajo</h4><p className={d.low.length ? 'low' : ''}>{d.low.length}</p></div>
    </div>
    <div className="card" style={{ marginBottom: 30 }}><h4>Ventas por mes</h4>
      {d.monthly.length ? <div className="bars">{d.monthly.map(m => <div key={m.m} style={{ height: (m.v / max) * 100 + '%' }} title={money(m.v)}><span>{m.m}</span></div>)}</div> : <p style={{ fontSize: 14 }}>Aún no hay facturas. Crea la primera en Facturas.</p>}</div>
    {d.low.length > 0 && <div className="card"><h4>Reponer pronto</h4>{d.low.map(p => <div key={p.id}>{p.name}: <span className="low">{p.stock}</span> (mínimo {p.min_stock})</div>)}</div>}
  </>;
}

function Inventory() {
  const initial = { id: null, sku: '', name: '', barcode: '', price: '', stock: '', min_stock: 5 };
  const [rows, load, err] = useLoad('/products'), [f, setF] = useState(initial), [e, setE] = useState('');
  const set = k => ev => setF({ ...f, [k]: ev.target.value });
  const findOrLoadByScan = async value => {
    const code = String(value || '').trim();
    if (!code) return;
    try {
      const match = await (await api(`/products/search?q=${encodeURIComponent(code)}`)).json();
      if (match.length) {
        const p = match[0];
        setF({ id: p.id, sku: p.sku || '', name: p.name || '', barcode: p.barcode || code, price: String(p.price ?? ''), stock: String(p.stock ?? ''), min_stock: String(p.min_stock ?? 5) });
        setE(`Producto encontrado: ${p.name}. Modifica los datos y guarda para actualizarlo.`);
      } else {
        setF({ ...initial, barcode: code });
      }
    } catch (x) { setE(x.message); }
  };
  const add = async ev => { ev.preventDefault(); setE(''); try { const { id, ...fields } = f; await api(id ? `/products/${id}` : '/products', { method: id ? 'PUT' : 'POST', body: { ...fields, price: +f.price, stock: +f.stock || 0, min_stock: +f.min_stock, barcode: (f.barcode || '').trim() } }); setF(initial); load(); } catch (x) { setE(x.message); } };
  const adjust = async p => { const v = prompt(`Ajuste de stock para ${p.name} (+entrada / −salida):`); if (v) { try { await api(`/products/${p.id}/stock`, { method: 'POST', body: { qty: v, reason: 'ajuste manual' } }); load(); } catch (x) { setE(x.message); } } };
  return <>
    <form className="row" onSubmit={add}>
      <input placeholder="SKU" value={f.sku} onChange={set('sku')} required />
      <input placeholder="Código de barras/QR" value={f.barcode} onChange={set('barcode')} onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); findOrLoadByScan(ev.target.value); } }} />
      <input placeholder="Nombre" value={f.name} onChange={set('name')} required /><input type="number" step="0.01" min="0" placeholder="Precio" value={f.price} onChange={set('price')} required />
      <input type="number" min="0" placeholder="Stock" value={f.stock} onChange={set('stock')} /><input type="number" min="0" placeholder="Mínimo" value={f.min_stock} onChange={set('min_stock')} />
      <button className="p">{f.id ? 'Actualizar producto' : 'Guardar producto'}</button>
      {f.id && <button type="button" onClick={() => { setF(initial); setE('Edición cancelada.'); }}>Cancelar edición</button>}
    </form>
    <small>Para escanear productos reales, registra su código EAN/UPC original en “Código de barras/QR”. Luego, en Ventas, activa la cámara y enfoca el código.</small>
    <Msg e={e || err} />
    <div className="scroll"><table><thead><tr><th>SKU</th><th>Producto</th><th>Precio</th><th>Stock</th><th></th></tr></thead>
      <tbody>{(rows || []).map(p => <tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{money(p.price)}</td>
        <td className={p.stock <= p.min_stock ? 'low' : ''}>{p.stock}{p.stock <= p.min_stock && ' ⚠'}</td><td><button onClick={() => adjust(p)}>Ajustar</button></td></tr>)}</tbody></table></div>
    {rows && !rows.length && <p>Sin productos todavía. Agrega el primero arriba.</p>}
  </>;
}

function Contacts() {
  const [type, setType] = useState('cliente'), [rows, load, err] = useLoad('/contacts?type=' + type), [e, setE] = useState('');
  const [f, setF] = useState({ name: '', nit: '', email: '', phone: '', category: '', notes: '' });
  const set = k => ev => setF({ ...f, [k]: ev.target.value });
  const add = async ev => { ev.preventDefault(); setE(''); try { await api('/contacts', { method: 'POST', body: { ...f, type } }); setF({ name: '', nit: '', email: '', phone: '', category: '', notes: '' }); load(); } catch (x) { setE(x.message); } };
  return <>
    <select value={type} onChange={ev => setType(ev.target.value)}><option value="cliente">Clientes</option><option value="proveedor">Proveedores</option></select>
    <form className="row" onSubmit={add}>
      <input placeholder="Nombre" value={f.name} onChange={set('name')} required /><input placeholder="NIT/DUI" value={f.nit} onChange={set('nit')} />
      <input type="email" placeholder="Correo" value={f.email} onChange={set('email')} /><input placeholder="Teléfono" value={f.phone} onChange={set('phone')} />
      <input placeholder="Categoría" value={f.category} onChange={set('category')} /><input placeholder="Notas" value={f.notes} onChange={set('notes')} />
      <button className="p">Guardar {type}</button></form>
    <Msg e={e || err} />
    <div className="scroll"><table><thead><tr><th>Nombre</th><th>NIT</th><th>Contacto</th><th>Categoría</th><th>Notas</th></tr></thead>
      <tbody>{(rows || []).map(c => <tr key={c.id}><td>{c.name}</td><td>{c.nit}</td><td>{c.email} {c.phone}</td><td>{c.category}</td><td>{c.notes}</td></tr>)}</tbody></table></div>
  </>;
}

function Invoices() {
  const [list, reload] = useLoad('/invoices'), [clients] = useLoad('/contacts?type=cliente'), [prods] = useLoad('/products');
  const [cid, setCid] = useState(''), [lines, setLines] = useState([{ product_id: '', qty: 1 }]), [e, setE] = useState(''), [ok, setOk] = useState(''), [scan, setScan] = useState(''), [preview, setPreview] = useState(null);
  const [cameraOn, setCameraOn] = useState(false), videoRef = useRef(null), scannerRef = useRef(null), cameraSessionRef = useRef(null);
  const upd = (i, k, v) => setLines(lines.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const sub = lines.reduce((s, l) => s + (prods?.find(p => p.id == l.product_id)?.price || 0) * (+l.qty || 0), 0);
  const addScannedLine = async (value = scan) => {
    const code = String(value || '').trim(); if (!code) return;
    try {
      const codeVariants = [code];
      if (/^\d{12}$/.test(code)) codeVariants.push(`0${code}`);
      if (/^0\d{12}$/.test(code)) codeVariants.push(code.slice(1));
      let p;
      for (const candidate of [...new Set(codeVariants)]) {
        const match = await (await api(`/products/search?q=${encodeURIComponent(candidate)}`)).json();
        p = match.find(product => product.barcode === candidate || product.sku === candidate);
        if (p) break;
      }
      if (!p) throw new Error(`No hay un producto registrado con el código ${code}. Regístralo en Inventario para poder venderlo.`);
      setPreview(p);
      const idx = lines.findIndex(l => String(l.product_id) === String(p.id));
      if (idx >= 0) {
        setLines(lines.map((l, i) => i === idx ? { ...l, qty: +l.qty + 1 } : l));
      } else {
        setLines([...lines, { product_id: String(p.id), qty: 1 }]);
      }
      setScan(''); setE('');
    } catch (x) { setE(x.message); setPreview(null); }
  };
  const stopCamera = () => {
    if (cameraSessionRef.current) cameraSessionRef.current.cancelled = true;
    scannerRef.current?.stop();
    scannerRef.current = null;
    setCameraOn(false);
  };
  useEffect(() => () => {
    if (cameraSessionRef.current) cameraSessionRef.current.cancelled = true;
    scannerRef.current?.stop();
  }, []);
  const toggleCamera = async () => {
    if (cameraOn) {
      stopCamera();
      return;
    }
    setE('');
    setCameraOn(true);
    const session = { cancelled: false };
    cameraSessionRef.current = session;
    try {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      if (session.cancelled) return;
      const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.ITF,
        BarcodeFormat.CODABAR,
        BarcodeFormat.QR_CODE,
      ]]]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, _error, activeControls) => {
        if (!result || session.cancelled) return;
        session.cancelled = true;
        activeControls.stop();
        scannerRef.current = null;
        setCameraOn(false);
        const code = result.getText().trim();
        setScan(code);
        void addScannedLine(code);
      });
      if (session.cancelled) controls.stop();
      else scannerRef.current = controls;
    } catch (x) {
      if (!session.cancelled) {
        setCameraOn(false);
        setE(`No se pudo activar la cámara: ${x.message}. Revisa el permiso de cámara y usa HTTPS o localhost.`);
      }
    }
  };
  const emit = async ev => {
    ev.preventDefault(); setE(''); setOk('');
    try { const r = await (await api('/invoices', { method: 'POST', body: { contact_id: +cid, items: lines.filter(l => l.product_id).map(l => ({ product_id: +l.product_id, qty: +l.qty })) } })).json();
      setOk(`Factura ${r.number} emitida por ${money(r.total)}`); setLines([{ product_id: '', qty: 1 }]); reload(); } catch (x) { setE(x.message); }
  };
  return <>
    <form className="card" onSubmit={emit} style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
      <select value={cid} onChange={ev => setCid(ev.target.value)} required><option value="">Elegir cliente…</option>{(clients || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <div className="row" style={{ margin: 0 }}>
        <input value={scan} onChange={ev => setScan(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); addScannedLine(); } }} placeholder="Escáner de código de barras / QR" />
        <button type="button" onClick={() => addScannedLine()}>Agregar por escáner</button>
        <button type="button" className="camera-button" onClick={toggleCamera}>{cameraOn ? 'Apagar cámara' : '📷 Escanear con cámara'}</button>
      </div>
      <div className={cameraOn ? 'camera-panel' : 'camera-panel camera-panel-hidden'}>
        <div className="camera-video-wrap">
          <video ref={videoRef} className="camera-preview" muted playsInline />
          <span className="camera-target" aria-hidden="true" />
        </div>
        <div className="camera-hint">
          <strong>Escaneo de producto activo</strong>
          <span>Compatible con códigos comerciales EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, ITF, Codabar y QR.</span>
          <span>El código debe estar guardado en el campo “Código de barras/QR” del producto. La lectura lo agrega a esta venta.</span>
        </div>
      </div>
      {preview && <div className="scan-preview">
        <div>
          <span>Producto detectado</span>
          <strong>{preview.name}</strong>
        </div>
        <div className="scan-meta">
          <span>SKU: {preview.sku || '—'}</span>
          <span>Precio: {money(preview.price)}</span>
          <span>Stock: {preview.stock}</span>
        </div>
      </div>}
      {lines.map((l, i) => <div key={i} className="row invoice-line" style={{ margin: 0 }}>
        <select value={l.product_id} onChange={ev => upd(i, 'product_id', ev.target.value)}><option value="">Producto…</option>{(prods || []).map(p => <option key={p.id} value={p.id}>{p.name} ({p.stock} disp.)</option>)}</select>
        <input type="number" min="1" value={l.qty} onChange={ev => upd(i, 'qty', ev.target.value)} style={{ width: 80 }} aria-label={`Cantidad de línea ${i + 1}`} />
        {lines.length > 1 && <button type="button" onClick={() => setLines(lines.filter((_, index) => index !== i))} aria-label={`Quitar línea ${i + 1}`}>Quitar</button>}
      </div>)}
      <div><button type="button" onClick={() => setLines([...lines, { product_id: '', qty: 1 }])}>Agregar línea</button></div>
      <div>Subtotal {money(sub)} · IVA 13% {money(sub * 0.13)} · <b>Total {money(sub * 1.13)}</b></div>
      <Msg e={e} /><Msg e={ok} ok /><button className="p">Emitir factura</button></form>
    <div className="scroll"><table><thead><tr><th>Número</th><th>Cliente</th><th>Total</th><th>Fecha</th><th></th></tr></thead>
      <tbody>{(list || []).map(i => <tr key={i.id}><td>{i.number}</td><td>{i.customer}</td><td>{money(i.total)}</td><td>{new Date(i.created_at).toLocaleDateString('es-SV')}</td>
        <td><InvoiceActions i={i} /></td></tr>)}</tbody></table></div>
  </>;
}

function Reports() {
  const [error, setError] = useState('');
  const exportReport = async kind => {
    setError('');
    try { await download(`/reports/${kind}`, `${kind}.csv`); } catch (x) { setError(x.message); }
  };
  return <section className="card reports-card"><h4>Descargar reportes (se abren en Excel)</h4>
    <Msg e={error} />
    <div className="report-list">
      {['ventas', 'inventario', 'movimientos', 'compras', 'gastos'].map(kind =>
        <button type="button" className="p" key={kind} onClick={() => exportReport(kind)}>{kind === 'ventas' ? 'Ventas de todos los vendedores' : `Reporte de ${kind}`}</button>
      )}
    </div>
  </section>;
}

const TABS = { Dashboard, Inventario: Inventory, Contactos: Contacts, Facturas: Invoices, Compras: Purchases, 'Caja y gastos': CashExpenses, Finanzas: Finance, Reportes: Reports, Usuarios: Users, 'Mi seguridad': EnrollBio };
const FINANCE_FOR = ['admin', 'contador'];

function GlobalSearch({ onNavigate }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const search = async ev => {
    ev.preventDefault();
    const term = query.trim().toLocaleLowerCase();
    if (!term) {
      setResults(null);
      setError('Escribe un producto, cliente o número de factura para buscar.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const [productsResponse, contactsResponse, invoicesResponse] = await Promise.all([
        api(`/products/search?q=${encodeURIComponent(query.trim())}`),
        api('/contacts'),
        api('/invoices'),
      ]);
      const [products, contacts, invoices] = await Promise.all([
        productsResponse.json(), contactsResponse.json(), invoicesResponse.json(),
      ]);
      const found = [
        ...products.map(item => ({ title: item.name, detail: `${item.sku} · ${money(item.price)}`, tab: 'Inventario' })),
        ...contacts.filter(item => `${item.name} ${item.nit || ''} ${item.email || ''}`.toLocaleLowerCase().includes(term)
          || String(item.phone || '').includes(query.trim()))
          .map(item => ({ title: item.name, detail: `${item.type} · ${item.email || item.phone || item.nit || ''}`, tab: 'Contactos' })),
        ...invoices.filter(item => `${item.number} ${item.customer}`.toLocaleLowerCase().includes(term))
          .map(item => ({ title: item.number, detail: `${item.customer} · ${money(item.total)}`, tab: 'Facturas' })),
      ].slice(0, 12);
      setResults(found);
      if (!found.length) setError('No se encontraron coincidencias.');
    } catch (x) {
      setResults(null);
      setError(x.message);
    } finally {
      setBusy(false);
    }
  };
  return <div className="global-search-wrap">
    <form className="search-box" onSubmit={search} role="search">
      <span className="search-icon" aria-hidden="true">⌕</span>
      <input type="search" value={query} onChange={ev => { setQuery(ev.target.value); setResults(null); setError(''); }} placeholder="Buscar productos, clientes, facturas..." aria-label="Buscar en el sistema" />
      <button type="submit" className="search-submit" disabled={busy}>{busy ? 'Buscando…' : 'Buscar'}</button>
    </form>
    {(results || error) && <div className="search-results" role="status">
      {error && <p>{error}</p>}
      {results?.map((result, index) => <button key={`${result.tab}-${result.title}-${index}`} type="button" className="search-result" onClick={() => { onNavigate(result.tab); setResults(null); }}>
        <strong>{result.title}</strong><span>{result.detail}</span><small>{result.tab}</small>
      </button>)}
    </div>}
  </div>;
}

function RightRail({ onNavigate, user }) {
  const [products, , productsError] = useLoad('/products');
  const [activity, , activityError] = useLoad('/activity');
  const lowStock = (products || []).filter(item => Number(item.stock) <= Number(item.min_stock)).slice(0, 6);
  const relativeTime = value => {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Hace ${hours} h`;
    return new Date(value).toLocaleDateString('es-SV');
  };
  return <aside className="right-rail">
    <div className="alert-card">
      <div className="rail-header">
        <h4>Alertas de stock</h4>
        <button type="button" className="link-btn" onClick={() => onNavigate('Inventario')}>Ver todas</button>
      </div>
      {productsError && <Msg e={productsError} />}
      <div className="alert-list">
        {lowStock.map(item => <button type="button" key={item.id} className="alert-item" onClick={() => onNavigate('Inventario')} title="Abrir inventario">
          <div className="mini-thumb">{item.name.slice(0, 2).toUpperCase()}</div>
          <div className="alert-copy"><strong>{item.name}</strong><span>SKU: {item.sku} · Stock bajo</span></div>
          <div className="alert-meta">{item.stock}</div>
        </button>)}
        {!productsError && products && !lowStock.length && <p className="rail-empty">No hay productos con stock bajo.</p>}
      </div>
    </div>
    <div className="activity-card">
      <div className="rail-header">
        <h4>Actividad reciente</h4>
        <button type="button" className="link-btn" onClick={() => onNavigate('Reportes')}>Ver historial</button>
      </div>
      {activityError && <Msg e={activityError} />}
      <div className="activity-list">
        {(activity || []).map((item, index) => <button type="button" key={`${item.type}-${item.created_at}-${index}`} className="activity-item" onClick={() => onNavigate(item.type === 'Venta' ? 'Facturas' : 'Inventario')}>
          <div className={`activity-badge ${item.type === 'Entrada' ? 'good' : item.type === 'Salida' ? 'bad' : 'info'}`}>{item.type}</div>
          <div className="activity-copy"><strong>{item.description}</strong><span>{item.user || user.name} · {relativeTime(item.created_at)}</span></div>
        </button>)}
        {!activityError && activity && !activity.length && <p className="rail-empty">Aún no hay actividad registrada.</p>}
      </div>
    </div>
  </aside>;
}

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(sessionStorage.getItem('u') || 'null')), [tab, setTab] = useState('Dashboard'), [about, setAbout] = useState(false), [secs, setSecs] = useState(0);
  useEffect(() => { const t = setInterval(() => setSecs(s => s + 1), 1000); return () => clearInterval(t); }, []);
  const logout = () => { sessionStorage.clear(); location.reload(); };
  if (!user) return <Login onLogin={setUser} />;
  if (user.role === 'cliente') return <main><p>Tu rol (cliente) aún no tiene portal. Pide al administrador acceso de empleado.</p><button onClick={logout}>Salir</button></main>;
  if (user.enroll) return <main><EnrollBio forced onDone={setUser} /><p><button onClick={logout}>Salir</button></p></main>;
  const tabs = Object.keys(TABS).filter(t => {
    if (t === 'Finanzas') return FINANCE_FOR.includes(user.role);
    if (t === 'Usuarios') return user.role === 'admin';
    return true;
  });
  const View = TABS[tab] && tabs.includes(tab) ? TABS[tab] : Dashboard, mm = String(Math.floor(secs / 60)).padStart(2, '0'), ss = String(secs % 60).padStart(2, '0');
  const menuItems = [
    { label: 'Dashboard', tab: 'Dashboard' },
    { label: 'Inventario', tab: 'Inventario' },
    { label: 'Ventas', tab: 'Facturas' },
    { label: 'Compras', tab: 'Compras' },
    { label: 'Clientes', tab: 'Contactos' },
    { label: 'Caja y gastos', tab: 'Caja y gastos' },
    { label: 'Finanzas', tab: 'Finanzas' },
    { label: 'Reportes', tab: 'Reportes' },
    { label: 'Usuarios', tab: 'Usuarios' },
    { label: 'Mi seguridad', tab: 'Mi seguridad' },
  ].filter(item => {
    if (item.tab === 'Finanzas') return FINANCE_FOR.includes(user.role);
    if (item.tab === 'Usuarios') return user.role === 'admin';
    if (item.tab === 'Mi seguridad') return true;
    return true;
  });
  const navigate = nextTab => { setAbout(false); setTab(nextTab); };

  return <div className="biz-shell">
    <aside className="sidebar">
      <div className="logo-box">
        <div className="logo-mark">A</div>
        <div className="logo-word">LAEL</div>
      </div>
      <nav className="sidebar-nav">
        {menuItems.map(item => (
          <button key={item.label} className={item.tab === tab ? 'nav-link active' : 'nav-link'} onClick={() => { setAbout(false); setTab(item.tab); }}>
            <span className="nav-icon">{item.label === 'Dashboard' ? '◫' : item.label === 'Inventario' ? '▣' : item.label === 'Ventas' ? '◌' : item.label === 'Compras' ? '▤' : item.label === 'Clientes' ? '◉' : item.label === 'Facturas' ? '▭' : item.label === 'Caja y gastos' ? '◍' : item.label === 'Finanzas' ? '◐' : item.label === 'Reportes' ? '◔' : item.label === 'Usuarios' ? '◒' : '◓'}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="mini-brand">LAEL</div>
        <p>"Tu inventario, nuestras soluciones, tu crecimiento."</p>
        <button type="button" className="link-btn" onClick={() => setAbout(true)}>Acerca de LAEL</button>
        <small>v2.0.0 • 2026</small>
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <GlobalSearch onNavigate={navigate} />
        <div className="topbar-right">
          <button type="button" className="icon-btn" title="Ver alertas de stock" aria-label="Ver alertas de stock" onClick={() => navigate('Inventario')}>🔔</button>
          <div className="user-pill">
            <div className="avatar">LA</div>
            <div className="user-meta">
              <strong>{user.name}</strong>
              <span>{user.role === 'contador' ? 'Contador' : user.role === 'admin' ? 'Administrador' : 'Empleado'}</span>
            </div>
          </div>
          <button type="button" className="logout-button" onClick={logout}>Salir</button>
          <span className="clock">{new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
          <span className="clock-clock">{new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
        </div>
      </header>

      <div className="workspace-body">
        <div className="content-panel">
          {about ? <div className="card">Desarrollado por Luis Ángel Escobar Leiva (LAEL). Propiedad intelectual de su autor.</div> : <View />}
        </div>

        <RightRail onNavigate={navigate} user={user} />
      </div>
    </div>
  </div>;
}
