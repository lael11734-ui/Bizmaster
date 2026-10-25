import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { api, money, fdate, download, printPdf, useLoad, Msg, setToken } from './lib.jsx';

// ---------- Acceso: clave + PIN + huella/rostro ----------
export function Login({ onLogin }) {
  const [f, setF] = useState({ name: '', email: '', password: '', pin: '' }), [reg, setReg] = useState(false), [needPin, setNeedPin] = useState(false), [showPassword, setShowPassword] = useState(false), [e, setE] = useState(''), [busy, setBusy] = useState(false);
  const set = k => ev => setF({ ...f, [k]: ev.target.value });
  const done = r => { setToken(r.token); sessionStorage.setItem('t', r.token); sessionStorage.setItem('u', JSON.stringify(r.user)); onLogin(r.user); };
  const signInWithBiometric = async () => {
    setE('');
    setBusy(true);
    try {
      const r = await (await api('/auth/login', { method: 'POST', body: { email: f.email, password: f.password } })).json();
      if (r.needs_pin) { setNeedPin(true); return; }
      if (r.needs_biometric) {
        setE('Usa huella o rostro en el dispositivo para continuar…');
        const resp = await startAuthentication(r.options);
        return done(await (await api('/auth/biometric/verify', { method: 'POST', body: { ticket: r.ticket, response: resp } })).json());
      }
      done(r);
    } catch (x) { setE(x.message); } finally { setBusy(false); }
  };
  const go = async ev => {
    ev.preventDefault(); setE(''); setBusy(true);
    try {
      if (reg) { await api('/auth/register', { method: 'POST', body: f }); setReg(false); }
      const r = await (await api('/auth/login', { method: 'POST', body: f })).json();
      if (r.needs_pin) { setNeedPin(true); setE('Ingresa el PIN que te proporcionó el administrador.'); return; }
      if (r.needs_biometric) {
        setE('Verifica tu huella o rostro en el diálogo del dispositivo…');
        const resp = await startAuthentication(r.options);
        return done(await (await api('/auth/biometric/verify', { method: 'POST', body: { ticket: r.ticket, response: resp } })).json());
      }
      done(r);
    } catch (x) { setE(x.message); } finally { setBusy(false); }
  };
  return <main className="login-page">
    <div className="login-scenery" aria-hidden="true" />
    <p className="login-side-copy">Grandes<br />ideas comienzan<br />aquí<span /></p>
    <form className="login" onSubmit={go}>
      <div className="login-brand" aria-label="BizMaster LAEL">
        <svg viewBox="0 0 100 54" role="img" aria-hidden="true">
          <path d="M4 49 31 12l23 37H4Z" fill="#6f9dc3" />
          <path d="m30 49 34-48 32 48H30Z" fill="#416f9c" />
          <path d="m51 49 19-28 20 28H51Z" fill="#244f7b" />
          <path d="m23 24 8-12 9 14-7-4-8 7Z" fill="#d8e8f3" />
        </svg>
      </div>
      <h2>{reg ? 'Crear cuenta' : 'Bienvenido'}</h2>
      <p className="login-subtitle">{reg ? 'Registra la cuenta de administrador' : 'Inicia sesión para continuar'}</p>
      {reg && <label className="login-field"><span className="login-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg></span><input placeholder="Nombre" value={f.name} onChange={set('name')} autoComplete="name" required /></label>}
      <label className="login-field"><span className="login-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg></span><input type="email" placeholder="Correo electrónico" value={f.email} onChange={set('email')} autoComplete="username" required /></label>
      <label className="login-field"><span className="login-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg></span><input type={showPassword ? 'text' : 'password'} placeholder="Contraseña" value={f.password} onChange={set('password')} autoComplete={reg ? 'new-password' : 'current-password'} required />
        <button className="password-toggle" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? 'Ocultar' : 'Ver'}</button>
      </label>
      {needPin && <label className="login-field"><span className="login-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg></span><input inputMode="numeric" placeholder="PIN que te dio el administrador" value={f.pin} onChange={set('pin')} autoFocus required /></label>}
      <Msg e={e} />
      <button className="p login-submit" disabled={busy}>{busy ? 'Procesando…' : reg ? 'Crear cuenta de administrador' : 'Iniciar sesión'}</button>
      {!reg && <div className="login-divider"><span />o<span /></div>}
      {!reg && <button type="button" className="biometric-button login-biometric" onClick={signInWithBiometric} disabled={busy}>Entrar con huella o rostro</button>}
      <p className="login-register">{reg ? '¿Ya tienes una cuenta?' : '¿No tienes una cuenta?'} <button type="button" onClick={() => { setReg(!reg); setNeedPin(false); setE(''); }}>{reg ? 'Inicia sesión' : 'Regístrate'}</button></p>
    </form>
    <p className="login-tagline">UN MEJOR<br />MAÑANA,<br />JUNTOS<span /></p>
  </main>;
}

export function EnrollBio({ forced, onDone }) {
  const [e, setE] = useState(''), [ok, setOk] = useState('');
  const go = async () => {
    setE(''); setOk('');
    try {
      const opts = await (await api('/me/biometric/options', { method: 'POST' })).json();
      const att = await startRegistration(opts);
      const r = await (await api('/me/biometric/verify', { method: 'POST', body: att })).json();
      setToken(r.token); sessionStorage.setItem('t', r.token);
      const u = { ...JSON.parse(sessionStorage.getItem('u')), enroll: false }; sessionStorage.setItem('u', JSON.stringify(u));
      setOk('Listo: desde ahora se te pedirá tu huella o rostro al entrar.'); onDone?.(u);
    } catch (x) { setE(x.message); }
  };
  return <div className="card biometric-panel" style={{ maxWidth: 520 }}>
    <h3 style={{ marginTop: 0 }}>{forced ? 'El administrador exige que registres tu huella o rostro' : 'Mi seguridad'}</h3>
    <p>Se usa el lector de huella, Face ID o Windows Hello de este dispositivo. Tu huella o rostro nunca sale del dispositivo ni se guarda en el servidor. Requiere HTTPS (o localhost).</p>
    <Msg e={e} /><Msg e={ok} ok /><button className="p" onClick={go}>Registrar huella / rostro en este dispositivo</button>
  </div>;
}

// ---------- Facturas: imprimir y enviar ----------
export function InvoiceActions({ i }) {
  const [msg, setMsg] = useState('');
  const [qr, setQr] = useState('');
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(`BizMaster LAEL|Factura ${i.number}|Total ${money(i.total)}`, { color: { dark: '#07111d', light: '#cfe2ff' } }).then(url => {
      if (active) setQr(url);
    }).catch(() => active && setQr(''));
    return () => { active = false; };
  }, [i]);
  const runAction = async action => {
    setMsg('');
    try { await action(); } catch (x) { setMsg(x.message); }
  };
  const mail = async () => {
    const to = prompt('Enviar la factura a este correo:'); if (!to) return;
    try { await api(`/invoices/${i.id}/email`, { method: 'POST', body: { to } }); setMsg('Enviada'); } catch (x) { setMsg(x.message); }
  };
  const p = `/invoices/${i.id}/pdf`;
  return <div className="invoice-actions">
    <button type="button" onClick={() => runAction(() => download(p, i.number + '.pdf', true))}>Ver PDF</button>
    <button type="button" onClick={() => runAction(() => printPdf(p))}>Imprimir</button>
    <button type="button" onClick={mail}>Correo</button>
    {qr && <img src={qr} alt={`QR factura ${i.number}`} className="qr-mini" />}
    {msg && <small>{msg}</small>}
  </div>;
}

// ---------- Usuarios (admin): roles, PIN, biometría, accesos ----------
export function Users() {
  const [rows, load, err] = useLoad('/users'), [logs, reloadLogs] = useLoad('/admin/logins'), [e, setE] = useState(''), [pin, setPin] = useState(null);
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'empleado' });
  const set = k => ev => setF({ ...f, [k]: ev.target.value });
  const run = async fn => { setE(''); try { await fn(); load(); reloadLogs(); } catch (x) { setE(x.message); } };
  const create = ev => { ev.preventDefault(); run(async () => { await api('/auth/register', { method: 'POST', body: f }); setF({ name: '', email: '', password: '', role: 'empleado' }); }); };
  const mkPin = u => run(async () => {
    const mail = !!u.email && confirm(`¿Enviar también el PIN por correo a ${u.email}? (Cancelar = solo mostrarlo aquí)`);
    const r = await (await api(`/users/${u.id}/pin`, { method: 'POST', body: { email: mail } })).json(); setPin({ name: u.name, ...r });
  });
  const patch = (u, body) => run(() => api(`/users/${u.id}`, { method: 'PATCH', body }));
  const exportAccess = async () => {
    setE('');
    try { await download('/reports/accesos', 'accesos.csv'); } catch (x) { setE(x.message); }
  };
  return <>
    <form className="row" onSubmit={create}>
      <input placeholder="Nombre" value={f.name} onChange={set('name')} required /><input type="email" placeholder="Correo" value={f.email} onChange={set('email')} required />
      <input type="password" placeholder="Contraseña inicial (mín. 8)" value={f.password} onChange={set('password')} required />
      <select value={f.role} onChange={set('role')}><option value="empleado">Empleado</option><option value="admin">Administrador</option><option value="contador">Contador</option><option value="cliente">Cliente</option></select>
      <button className="p">Crear usuario</button></form>
    <Msg e={e || err} />
    {pin && <div className="card pin" role="status"><b>PIN de {pin.name}: {pin.pin}</b> {pin.emailed && '(también enviado por correo)'}<br /><small>Entrégalo de forma privada. No se vuelve a mostrar; si se pierde, genera uno nuevo.</small> <button onClick={() => setPin(null)}>Ocultar</button></div>}
    <div className="scroll"><table><thead><tr><th>Usuario</th><th>Rol</th><th>PIN</th><th>Huella/rostro</th><th>Exigir biometría</th><th>Último acceso</th></tr></thead>
      <tbody>{(rows || []).map(u => <tr key={u.id}><td>{u.name}<br /><small>{u.email}</small></td>
        <td><select value={u.role} onChange={ev => patch(u, { role: ev.target.value })}><option value="admin">Administrador</option><option value="empleado">Empleado</option><option value="contador">Contador</option><option value="cliente">Cliente</option></select></td>
        <td>{u.has_pin ? 'Sí' : 'No'} <button onClick={() => mkPin(u)}>{u.has_pin ? 'Nuevo PIN' : 'Generar PIN'}</button></td>
        <td>{u.bio ? `${u.bio} registrada(s)` : 'Ninguna'}</td>
        <td><input type="checkbox" checked={!!u.require_bio} onChange={ev => patch(u, { require_bio: ev.target.checked })} aria-label={`Exigir biometría a ${u.name}`} /></td>
        <td>{fdate(u.last_login)}</td></tr>)}</tbody></table></div>
    <h3>Entradas al sistema (últimas 200)</h3>
    <p><button type="button" onClick={exportAccess}>Descargar accesos (Excel)</button></p>
    <div className="scroll"><table><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Resultado</th><th>Método</th><th>IP</th></tr></thead>
      <tbody>{(logs || []).map(l => <tr key={l.id}><td>{fdate(l.at)}</td><td>{l.name || l.email}</td><td className={l.ok ? '' : 'low'}>{l.ok ? 'Entró' : 'Falló'}</td><td>{l.method}</td><td>{l.ip}</td></tr>)}</tbody></table></div>
  </>;
}

// ---------- Compras y cuentas por pagar ----------
export function Purchases() {
  const [list, reload, err] = useLoad('/purchases'), [pay, reloadPay] = useLoad('/payables'), [sup] = useLoad('/contacts?type=proveedor'), [prods] = useLoad('/products');
  const [sid, setSid] = useState(''), [due, setDue] = useState(''), [lines, setLines] = useState([{ product_id: '', qty: 1, unit_cost: '' }]), [e, setE] = useState('');
  const upd = (i, k, v) => setLines(lines.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const total = lines.reduce((s, l) => s + (+l.qty || 0) * (+l.unit_cost || 0), 0);
  const refresh = () => { reload(); reloadPay(); };
  const act = async (id, what) => { setE(''); try { await api(`/purchases/${id}/${what}`, { method: 'POST' }); refresh(); } catch (x) { setE(x.message); } };
  const create = async ev => {
    ev.preventDefault(); setE('');
    try { await api('/purchases', { method: 'POST', body: { supplier_id: +sid, due_date: due || null, items: lines.filter(l => l.product_id).map(l => ({ product_id: +l.product_id, qty: +l.qty, unit_cost: +l.unit_cost })) } });
      setLines([{ product_id: '', qty: 1, unit_cost: '' }]); setDue(''); refresh(); } catch (x) { setE(x.message); }
  };
  return <>
    <div className="cards"><div className="card"><h4>Cuentas por pagar</h4><p>{money((pay || []).reduce((s, x) => s + +x.total, 0))}</p></div>
      <div className="card"><h4>Órdenes por pagar</h4><p>{(pay || []).length}</p></div></div>
    <form className="card" onSubmit={create} style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
      <div className="row" style={{ margin: 0 }}><select value={sid} onChange={ev => setSid(ev.target.value)} required><option value="">Proveedor…</option>{(sup || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <label>Vence <input type="date" value={due} onChange={ev => setDue(ev.target.value)} /></label></div>
      {lines.map((l, i) => <div key={i} className="row" style={{ margin: 0 }}>
        <select value={l.product_id} onChange={ev => upd(i, 'product_id', ev.target.value)}><option value="">Producto…</option>{(prods || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input type="number" min="1" value={l.qty} onChange={ev => upd(i, 'qty', ev.target.value)} style={{ width: 80 }} aria-label="Cantidad" />
        <input type="number" min="0" step="0.01" placeholder="Costo unit." value={l.unit_cost} onChange={ev => upd(i, 'unit_cost', ev.target.value)} style={{ width: 110 }} /></div>)}
      <div><button type="button" onClick={() => setLines([...lines, { product_id: '', qty: 1, unit_cost: '' }])}>Agregar línea</button></div>
      <div><b>Total {money(total)}</b></div><Msg e={e || err} /><button className="p">Crear orden de compra</button></form>
    <div className="scroll"><table><thead><tr><th>Orden</th><th>Proveedor</th><th>Estado</th><th>Total</th><th>Vence</th><th></th></tr></thead>
      <tbody>{(list || []).map(o => <tr key={o.id}><td>{o.number}</td><td>{o.supplier}</td><td>{o.status}{o.paid_at && ' · pagada'}</td><td>{money(o.total)}</td><td>{o.due_date ? new Date(o.due_date).toLocaleDateString('es-SV') : '—'}</td>
        <td>{o.status === 'pendiente' && <><button onClick={() => act(o.id, 'receive')}>Recibir</button> <button onClick={() => act(o.id, 'cancel')}>Anular</button></>}
          {o.status === 'recibida' && !o.paid_at && <button onClick={() => act(o.id, 'pay')}>Registrar pago</button>}</td></tr>)}</tbody></table></div>
  </>;
}

// ---------- Caja y gastos ----------
export function CashExpenses() {
  const [c, loadC] = useLoad('/cash/current'), [ex, loadEx] = useLoad('/expenses'), [e, setE] = useState(''), [res, setRes] = useState(null);
  const [amt, setAmt] = useState(''), [f, setF] = useState({ concept: '', category: 'Servicios', amount: '' });
  const set = k => ev => setF({ ...f, [k]: ev.target.value });
  const open = async ev => { ev.preventDefault(); setE(''); setRes(null); try { await api('/cash/open', { method: 'POST', body: { opening: +amt } }); setAmt(''); loadC(); } catch (x) { setE(x.message); } };
  const close = async ev => { ev.preventDefault(); setE(''); try { setRes(await (await api('/cash/close', { method: 'POST', body: { counted: +amt } })).json()); setAmt(''); loadC(); } catch (x) { setE(x.message); } };
  const addEx = async ev => { ev.preventDefault(); setE(''); try { await api('/expenses', { method: 'POST', body: { ...f, amount: +f.amount } }); setF({ concept: '', category: 'Servicios', amount: '' }); loadEx(); loadC(); } catch (x) { setE(x.message); } };
  return <>
    <div className="card" style={{ marginBottom: 16 }}><h4>Caja</h4>
      {c?.session ? <form className="row" onSubmit={close}><span>Abierta desde {fdate(c.session.opened_at)} · apertura {money(c.session.opening)} · <b>esperado {money(c.expected)}</b> (ventas tratadas como efectivo)</span>
        <input type="number" min="0" step="0.01" placeholder="Efectivo contado" value={amt} onChange={ev => setAmt(ev.target.value)} required /><button className="p">Cerrar caja</button></form>
        : <form className="row" onSubmit={open}><input type="number" min="0" step="0.01" placeholder="Monto de apertura" value={amt} onChange={ev => setAmt(ev.target.value)} required /><button className="p">Abrir caja</button></form>}
      {res && <div className={res.difference ? 'err' : 'okm'}>Cierre: esperado {money(res.expected)}, contado {money(res.counted)}, diferencia {money(res.difference)}</div>}</div>
    <h3>Registrar gasto</h3>
    <form className="row" onSubmit={addEx}><input placeholder="Concepto" value={f.concept} onChange={set('concept')} required />
      <select value={f.category} onChange={set('category')}>{['Servicios', 'Alquiler', 'Salarios', 'Transporte', 'Impuestos', 'Mantenimiento', 'Otros'].map(x => <option key={x}>{x}</option>)}</select>
      <input type="number" min="0.01" step="0.01" placeholder="Monto" value={f.amount} onChange={set('amount')} required /><button className="p">Guardar gasto</button></form>
    <Msg e={e} />
    <div className="scroll"><table><thead><tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Monto</th></tr></thead>
      <tbody>{(ex || []).map(x => <tr key={x.id}><td>{new Date(x.date).toLocaleDateString('es-SV')}</td><td>{x.category}</td><td>{x.concept}</td><td>{money(x.amount)}</td></tr>)}</tbody></table></div>
  </>;
}

// ---------- Finanzas (admin) ----------
export function Finance() {
  const [r, setR] = useState({ from: '', to: '' }), qs = (r.from ? `from=${r.from}&` : '') + (r.to ? `to=${r.to}` : '');
  const [d, , err] = useLoad('/finance/summary?' + qs);
  const [employees, , employeesErr] = useLoad('/finance/employees');
  const [payments, reloadPayments, paymentsErr] = useLoad('/finance/employee-payments');
  const [paymentForm, setPaymentForm] = useState({ employee_id: '', amount: '', pay_date: '', period_start: '', period_end: '', notes: '' });
  const [paymentError, setPaymentError] = useState('');
  const setPaymentField = key => ev => setPaymentForm({ ...paymentForm, [key]: ev.target.value });
  const addPayment = async ev => {
    ev.preventDefault();
    setPaymentError('');
    try {
      await api('/finance/employee-payments', { method: 'POST', body: { ...paymentForm, employee_id: Number(paymentForm.employee_id), amount: Number(paymentForm.amount) } });
      setPaymentForm({ employee_id: '', amount: '', pay_date: '', period_start: '', period_end: '', notes: '' });
      reloadPayments();
    } catch (x) { setPaymentError(x.message); }
  };
  const exportPayments = async () => {
    setPaymentError('');
    try { await download('/reports/pagos-empleados', 'pagos-empleados.csv'); } catch (x) { setPaymentError(x.message); }
  };
  return <>
    <div className="row"><label>Desde <input type="date" value={r.from} onChange={ev => setR({ ...r, from: ev.target.value })} /></label>
      <label>Hasta <input type="date" value={r.to} onChange={ev => setR({ ...r, to: ev.target.value })} /></label></div>
    <Msg e={err || employeesErr || paymentsErr} />
    {d && <><p><small>Periodo {d.from} a {d.to}. Utilidad en base de caja: ventas sin IVA menos gastos pagados (incluye compras ya pagadas).</small></p>
      <div className="cards">
        <div className="card"><h4>Ventas (sin IVA)</h4><p>{money(d.ventas)}</p></div><div className="card"><h4>IVA cobrado</h4><p>{money(d.iva)}</p></div>
        <div className="card"><h4>Gastos</h4><p>{money(d.gastos)}</p></div><div className="card"><h4>Utilidad</h4><p className={d.utilidad < 0 ? 'low' : ''}>{money(d.utilidad)}</p></div>
        <div className="card"><h4>Por pagar a proveedores</h4><p>{money(d.porPagar)}</p></div><div className="card"><h4>Facturas emitidas</h4><p>{d.facturas}</p></div></div>
      <table><thead><tr><th>Categoría de gasto</th><th>Total</th></tr></thead><tbody>{d.categorias.map(c => <tr key={c.category}><td>{c.category}</td><td>{money(c.v)}</td></tr>)}</tbody></table></>}
    <section className="finance-payroll">
      <div className="payroll-heading">
        <div><h3>Pagos de empleados</h3><p>Registra los pagos realizados. Se reflejan automáticamente como gasto de salarios en Finanzas.</p></div>
        <button type="button" onClick={exportPayments}>Descargar Excel de pagos</button>
      </div>
      <form className="payroll-form" onSubmit={addPayment}>
        <label>Empleado
          <select value={paymentForm.employee_id} onChange={setPaymentField('employee_id')} required>
            <option value="">{employees?.length ? 'Seleccionar empleado…' : 'No hay empleados registrados'}</option>
            {(employees || []).map(employee => <option key={employee.id} value={employee.id}>{employee.name} · {employee.role}</option>)}
          </select>
        </label>
        <label>Monto
          <input type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={setPaymentField('amount')} placeholder="$0.00" required />
        </label>
        <label>Fecha de pago
          <input type="date" value={paymentForm.pay_date} onChange={setPaymentField('pay_date')} required />
        </label>
        <label>Período desde
          <input type="date" value={paymentForm.period_start} onChange={setPaymentField('period_start')} required />
        </label>
        <label>Período hasta
          <input type="date" value={paymentForm.period_end} onChange={setPaymentField('period_end')} required />
        </label>
        <label className="payroll-notes">Observaciones
          <input maxLength="500" value={paymentForm.notes} onChange={setPaymentField('notes')} placeholder="Opcional" />
        </label>
        <button className="p payroll-submit" disabled={!employees?.length}>Registrar pago</button>
      </form>
      <Msg e={paymentError} />
      <div className="scroll"><table><thead><tr><th>Empleado</th><th>Monto</th><th>Fecha de pago</th><th>Período</th><th>Observaciones</th><th>Registrado por</th></tr></thead>
        <tbody>{(payments || []).map(payment => <tr key={payment.id}>
          <td>{payment.employee}</td><td>{money(payment.amount)}</td><td>{payment.pay_date}</td>
          <td>{payment.period_start} a {payment.period_end}</td><td>{payment.notes || '—'}</td><td>{payment.registered_by}</td>
        </tr>)}</tbody></table></div>
      {payments && !payments.length && <p className="small-note">Todavía no hay pagos registrados.</p>}
    </section>
  </>;
}
