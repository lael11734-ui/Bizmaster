// BizMaster LAEL v0.2: seguridad (PIN, biometría, accesos), correo de facturas, compras, caja, gastos y finanzas.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import crypto from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

export function mountExtra(app, { q, pool, auth, wrap, STAFF }) {
  const SECRET = process.env.JWT_SECRET, RP_ID = process.env.RP_ID || 'localhost', ORIGIN = process.env.ORIGIN || 'http://localhost:5173';
  const challenges = new Map(), fails = new Map();
  const fail = (s, m) => Object.assign(new Error(m), { status: s });
  const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 587, secure: process.env.SMTP_SECURE === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }) : null;
  const send = (opts) => { if (!mailer) throw fail(503, 'SMTP no configurado en backend/.env'); return mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, ...opts }); };
  const log = (uid, email, ok, method, req) => q('INSERT INTO login_log(user_id,email,ok,method,ip) VALUES(?,?,?,?,?)', [uid || null, email, ok ? 1 : 0, method, req.ip]);
  const tx = async fn => { const cn = await pool.getConnection(); try { await cn.beginTransaction(); const r = await fn(cn); await cn.commit(); return r; } catch (e) { await cn.rollback(); throw e; } finally { cn.release(); } };
  const money2 = n => Math.round(n * 100) / 100;

  // ---------- Login con PIN y biometría ----------
  const finish = async (u, creds, method, req, res) => {
    const enroll = !!u.require_bio && !creds.length;
    const token = jwt.sign({ id: u.id, role: u.role, name: u.name, enroll }, SECRET, { expiresIn: '8h' });
    await log(u.id, u.email, true, method, req);
    res.json({ token, user: { name: u.name, role: u.role, enroll } });
  };
  app.post('/api/auth/login', wrap(async (req, res) => {
    const { email = '', password = '', pin } = req.body;
    const key = email.toLowerCase() + '|' + req.ip, f = fails.get(key) || { n: 0, t: 0 }, fresh = Date.now() - f.t < 15 * 60e3;
    if (fresh && f.n >= 5) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    const [u] = await q('SELECT * FROM users WHERE email=?', [email]);
    const bad = async why => { fails.set(key, { n: (fresh ? f.n : 0) + 1, t: Date.now() }); await log(u?.id, email, false, why, req); return res.status(401).json({ error: 'Credenciales incorrectas' }); };
    if (!u || !(await bcrypt.compare(password, u.password_hash))) return bad('clave');
    if (u.pin_hash) {
      if (!pin) return res.json({ needs_pin: true });
      if (!(await bcrypt.compare(String(pin), u.pin_hash))) return bad('pin');
    }
    const creds = await q('SELECT cred_id FROM webauthn_credentials WHERE user_id=?', [u.id]);
    if (creds.length) {
      const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'required', allowCredentials: creds.map(c => ({ id: Buffer.from(c.cred_id, 'base64url'), type: 'public-key' })) });
      challenges.set(u.id, options.challenge);
      return res.json({ needs_biometric: true, options, ticket: jwt.sign({ id: u.id, purpose: 'bio' }, SECRET, { expiresIn: '5m' }) });
    }
    fails.delete(key);
    await finish(u, creds, u.pin_hash ? 'clave+pin' : 'clave', req, res);
  }));

  app.post('/api/auth/biometric/verify', wrap(async (req, res) => {
    let t; try { t = jwt.verify(req.body.ticket, SECRET); if (t.purpose !== 'bio') throw 0; } catch { return res.status(401).json({ error: 'La verificación venció. Inicia sesión otra vez.' }); }
    const [u] = await q('SELECT * FROM users WHERE id=?', [t.id]);
    const expected = challenges.get(t.id); challenges.delete(t.id);
    const creds = await q('SELECT * FROM webauthn_credentials WHERE user_id=?', [t.id]);
    const c = creds.find(x => x.cred_id === req.body.response?.id);
    const v = c && expected ? await verifyAuthenticationResponse({ response: req.body.response, expectedChallenge: expected, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
      authenticator: { credentialID: Buffer.from(c.cred_id, 'base64url'), credentialPublicKey: c.public_key, counter: c.counter } }).catch(() => null) : null;
    if (!v?.verified) { await log(u?.id, u?.email, false, 'biometria', req); return res.status(401).json({ error: 'No se pudo verificar tu huella o rostro' }); }
    await q('UPDATE webauthn_credentials SET counter=? WHERE id=?', [v.authenticationInfo.newCounter, c.id]);
    await finish(u, creds, 'biometria', req, res);
  }));

  // Registro de huella/rostro del propio usuario (también para quien debe enrolarse a la fuerza)
  app.post('/api/me/biometric/options', auth(), wrap(async (req, res) => {
    const [u] = await q('SELECT * FROM users WHERE id=?', [req.user.id]);
    const ex = await q('SELECT cred_id FROM webauthn_credentials WHERE user_id=?', [u.id]);
    const options = await generateRegistrationOptions({ rpName: 'BizMaster LAEL', rpID: RP_ID, userID: String(u.id), userName: u.email, attestationType: 'none',
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      excludeCredentials: ex.map(c => ({ id: Buffer.from(c.cred_id, 'base64url'), type: 'public-key' })) });
    challenges.set(u.id, options.challenge);
    res.json(options);
  }));
  app.post('/api/me/biometric/verify', auth(), wrap(async (req, res) => {
    const expected = challenges.get(req.user.id); challenges.delete(req.user.id);
    const v = expected ? await verifyRegistrationResponse({ response: req.body, expectedChallenge: expected, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true }).catch(() => null) : null;
    if (!v?.verified) return res.status(400).json({ error: 'No se pudo registrar tu huella o rostro' });
    const { credentialID, credentialPublicKey, counter } = v.registrationInfo;
    await q('INSERT INTO webauthn_credentials(user_id,cred_id,public_key,counter) VALUES(?,?,?,?)', [req.user.id, Buffer.from(credentialID).toString('base64url'), Buffer.from(credentialPublicKey), counter]);
    res.json({ ok: true, token: jwt.sign({ id: req.user.id, role: req.user.role, name: req.user.name, enroll: false }, SECRET, { expiresIn: '8h' }) });
  }));

  // ---------- Administración de usuarios ----------
  app.get('/api/users', auth('admin'), wrap(async (_r, res) => res.json(await q(
    `SELECT u.id,u.name,u.email,u.role,u.require_bio,(u.pin_hash IS NOT NULL) has_pin,
     (SELECT COUNT(*) FROM webauthn_credentials w WHERE w.user_id=u.id) bio,
     (SELECT MAX(at) FROM login_log l WHERE l.user_id=u.id AND l.ok=1) last_login FROM users u ORDER BY u.name`))));
  app.patch('/api/users/:id', auth('admin'), wrap(async (req, res) => {
    const { role, require_bio } = req.body;
    if (role !== undefined) {
      if (!['admin', 'empleado', 'cliente', 'contador'].includes(role)) throw fail(400, 'Rol inválido');
      if (+req.params.id === req.user.id && role !== 'admin') throw fail(400, 'No puedes quitarte tu propio rol de administrador');
      await q('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
    }
    if (require_bio !== undefined) await q('UPDATE users SET require_bio=? WHERE id=?', [require_bio ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  }));
  app.post('/api/users/:id/pin', auth('admin'), wrap(async (req, res) => {
    const [u] = await q('SELECT name,email FROM users WHERE id=?', [req.params.id]);
    if (!u) throw fail(404, 'Usuario no existe');
    const pin = String(crypto.randomInt(100000, 1000000));
    await q('UPDATE users SET pin_hash=? WHERE id=?', [await bcrypt.hash(pin, 10), req.params.id]);
    let emailed = false;
    if (req.body.email && u.email) { await send({ to: u.email, subject: 'Tu PIN de acceso a BizMaster LAEL', text: `Hola ${u.name}, tu PIN es ${pin}. No lo compartas.` }); emailed = true; }
    res.json({ pin, emailed });
  }));
  app.get('/api/admin/logins', auth('admin'), wrap(async (_r, res) => res.json(await q(
    'SELECT l.id,l.at,l.ok,l.method,l.ip,l.email,u.name FROM login_log l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 200'))));

  // ---------- Facturas por correo ----------
  const pdfBuffer = async id => {
    const [inv] = await q('SELECT i.*,c.name cname,c.nit,c.email cemail FROM invoices i JOIN contacts c ON c.id=i.contact_id WHERE i.id=?', [id]);
    if (!inv) return null;
    const items = await q('SELECT ii.qty,ii.unit_price,p.name FROM invoice_items ii JOIN products p ON p.id=ii.product_id WHERE invoice_id=?', [id]);
    const d = new PDFDocument({ margin: 50 }), chunks = []; d.on('data', c => chunks.push(c));
    d.fontSize(20).fillColor('#1d4ed8').text('BizMaster LAEL').fontSize(10).fillColor('#475569').text('Documento interno (no sustituye al DTE de Hacienda)').moveDown();
    d.fillColor('#000').fontSize(12).text(`Factura ${inv.number}`).text(`Cliente: ${inv.cname}  NIT: ${inv.nit || '-'}`).text(`Fecha: ${new Date(inv.created_at).toLocaleString('es-SV')}`).moveDown();
    items.forEach(i => d.text(`${i.qty} x ${i.name}   $${Number(i.unit_price).toFixed(2)}   = $${(i.qty * i.unit_price).toFixed(2)}`));
    d.moveDown().text(`Subtotal: $${Number(inv.subtotal).toFixed(2)}`).text(`IVA 13%: $${Number(inv.iva).toFixed(2)}`).fontSize(14).text(`TOTAL: $${Number(inv.total).toFixed(2)}`);
    await new Promise(r => { d.on('end', r); d.end(); });
    return { buf: Buffer.concat(chunks), inv };
  };
  app.post('/api/invoices/:id/email', auth(...STAFF), wrap(async (req, res) => {
    const out = await pdfBuffer(req.params.id);
    if (!out) throw fail(404, 'Factura no encontrada');
    const to = req.body.to || out.inv.cemail;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to || '')) throw fail(400, 'Correo de destino inválido');
    await send({ to, subject: `Factura ${out.inv.number} - BizMaster LAEL`, text: `Adjuntamos su factura ${out.inv.number} por $${Number(out.inv.total).toFixed(2)}.`, attachments: [{ filename: out.inv.number + '.pdf', content: out.buf }] });
    res.json({ ok: true });
  }));

  // ---------- Compras y cuentas por pagar ----------
  app.get('/api/purchases', auth(...STAFF), wrap(async (_r, res) => res.json(await q(
    'SELECT p.id,p.number,p.status,p.total,p.due_date,p.paid_at,p.created_at,c.name supplier FROM purchase_orders p JOIN contacts c ON c.id=p.supplier_id ORDER BY p.id DESC LIMIT 200'))));
  app.get('/api/payables', auth(...STAFF), wrap(async (_r, res) => res.json(await q(
    "SELECT p.id,p.number,p.total,p.due_date,c.name supplier FROM purchase_orders p JOIN contacts c ON c.id=p.supplier_id WHERE p.status='recibida' AND p.paid_at IS NULL ORDER BY p.due_date IS NULL, p.due_date"))));
  app.post('/api/purchases', auth(...STAFF), wrap(async (req, res) => {
    const { supplier_id, items, due_date } = req.body;
    if (!supplier_id || !Array.isArray(items) || !items.length) throw fail(400, 'Proveedor y al menos un producto son obligatorios');
    let total = 0;
    for (const it of items) { if (!it.product_id || !(it.qty > 0) || !(it.unit_cost >= 0)) throw fail(400, 'Producto, cantidad y costo válidos'); total += it.qty * it.unit_cost; }
    total = money2(total);
    const r = await tx(async cn => {
      const [po] = await cn.query('INSERT INTO purchase_orders(supplier_id,total,due_date,user_id) VALUES(?,?,?,?)', [supplier_id, total, due_date || null, req.user.id]);
      const number = 'OC-' + String(po.insertId).padStart(6, '0');
      await cn.query('UPDATE purchase_orders SET number=? WHERE id=?', [number, po.insertId]);
      for (const it of items) await cn.query('INSERT INTO purchase_items(po_id,product_id,qty,unit_cost) VALUES(?,?,?,?)', [po.insertId, it.product_id, it.qty, it.unit_cost]);
      return { id: po.insertId, number, total };
    });
    res.status(201).json(r);
  }));
  app.post('/api/purchases/:id/receive', auth(...STAFF), wrap(async (req, res) => {
    await tx(async cn => {
      const [[po]] = await cn.query('SELECT * FROM purchase_orders WHERE id=? FOR UPDATE', [req.params.id]);
      if (!po) throw fail(404, 'Orden no existe');
      if (po.status !== 'pendiente') throw fail(409, 'La orden ya no está pendiente');
      const [items] = await cn.query('SELECT * FROM purchase_items WHERE po_id=?', [po.id]);
      for (const i of items) {
        await cn.query('UPDATE products SET stock=stock+? WHERE id=?', [i.qty, i.product_id]);
        await cn.query('INSERT INTO stock_moves(product_id,qty,reason,user_id) VALUES(?,?,?,?)', [i.product_id, i.qty, 'compra ' + po.number, req.user.id]);
      }
      await cn.query("UPDATE purchase_orders SET status='recibida', received_at=NOW() WHERE id=?", [po.id]);
    });
    res.json({ ok: true });
  }));
  app.post('/api/purchases/:id/pay', auth(...STAFF), wrap(async (req, res) => {
    await tx(async cn => {
      const [[po]] = await cn.query('SELECT * FROM purchase_orders WHERE id=? FOR UPDATE', [req.params.id]);
      if (!po) throw fail(404, 'Orden no existe');
      if (po.status !== 'recibida') throw fail(409, 'Solo se paga una orden ya recibida');
      if (po.paid_at) throw fail(409, 'La orden ya está pagada');
      await cn.query("INSERT INTO expenses(concept,category,amount,date,user_id) VALUES(?,?,?,CURDATE(),?)", ['Pago ' + po.number, 'Compras', po.total, req.user.id]);
      await cn.query('UPDATE purchase_orders SET paid_at=NOW() WHERE id=?', [po.id]);
    });
    res.json({ ok: true });
  }));
  app.post('/api/purchases/:id/cancel', auth(...STAFF), wrap(async (req, res) => {
    const r = await q("UPDATE purchase_orders SET status='anulada' WHERE id=? AND status='pendiente'", [req.params.id]);
    if (!r.affectedRows) throw fail(409, 'Solo se anulan órdenes pendientes');
    res.json({ ok: true });
  }));

  // ---------- Gastos y caja ----------
  app.get('/api/expenses', auth(...STAFF), wrap(async (_r, res) => res.json(await q('SELECT id,concept,category,amount,date FROM expenses ORDER BY date DESC, id DESC LIMIT 200'))));
  app.post('/api/expenses', auth(...STAFF), wrap(async (req, res) => {
    const { concept, category, amount, date } = req.body;
    if (!concept || !(amount > 0)) throw fail(400, 'Concepto y monto mayor a cero son obligatorios');
    await q('INSERT INTO expenses(concept,category,amount,date,user_id) VALUES(?,?,?,COALESCE(?,CURDATE()),?)', [concept, category || 'Otros', amount, date || null, req.user.id]);
    res.status(201).json({ ok: true });
  }));
  const openSession = async () => (await q('SELECT * FROM cash_sessions WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1'))[0];
  const expectedCash = async s => {
    const [a] = await q('SELECT COALESCE(SUM(total),0) v FROM invoices WHERE created_at>=?', [s.opened_at]);
    const [b] = await q('SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE created_at>=?', [s.opened_at]);
    return money2(+s.opening + +a.v - +b.v);
  };
  app.get('/api/cash/current', auth(...STAFF), wrap(async (_r, res) => { const s = await openSession(); res.json(s ? { session: s, expected: await expectedCash(s) } : { session: null }); }));
  app.post('/api/cash/open', auth(...STAFF), wrap(async (req, res) => {
    if (await openSession()) throw fail(409, 'Ya hay una caja abierta');
    if (!(req.body.opening >= 0)) throw fail(400, 'Monto de apertura inválido');
    await q('INSERT INTO cash_sessions(opening,user_id) VALUES(?,?)', [req.body.opening, req.user.id]);
    res.status(201).json({ ok: true });
  }));
  app.post('/api/cash/close', auth(...STAFF), wrap(async (req, res) => {
    const s = await openSession();
    if (!s) throw fail(409, 'No hay caja abierta');
    if (!(req.body.counted >= 0)) throw fail(400, 'Monto contado inválido');
    const expected = await expectedCash(s);
    await q('UPDATE cash_sessions SET closed_at=NOW(), expected=?, counted=? WHERE id=?', [expected, req.body.counted, s.id]);
    res.json({ expected, counted: +req.body.counted, difference: money2(req.body.counted - expected) });
  }));

  // ---------- Finanzas (administrador y contador) ----------
  app.get('/api/finance/summary', auth('admin', 'contador'), wrap(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10), from = req.query.from || today.slice(0, 8) + '01', to = req.query.to || today;
    const [v] = await q('SELECT COALESCE(SUM(subtotal),0) subtotal, COALESCE(SUM(iva),0) iva, COUNT(*) n FROM invoices WHERE DATE(created_at) BETWEEN ? AND ?', [from, to]);
    const [g] = await q('SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE date BETWEEN ? AND ?', [from, to]);
    const cats = await q('SELECT category, SUM(amount) v FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY v DESC', [from, to]);
    const [p] = await q("SELECT COALESCE(SUM(total),0) v FROM purchase_orders WHERE status='recibida' AND paid_at IS NULL");
    res.json({ from, to, ventas: +v.subtotal, iva: +v.iva, facturas: v.n, gastos: +g.v, utilidad: money2(v.subtotal - g.v), porPagar: +p.v, categorias: cats });
  }));

  // ---------- Pagos de empleados (administrador y contador) ----------
  app.get('/api/finance/employees', auth('admin', 'contador'), wrap(async (_req, res) => {
    res.json(await q("SELECT id,name,role FROM users WHERE role='empleado' ORDER BY name"));
  }));
  app.get('/api/finance/employee-payments', auth('admin', 'contador'), wrap(async (_req, res) => {
    res.json(await q(
      `SELECT p.id,p.amount,DATE_FORMAT(p.pay_date,'%Y-%m-%d') pay_date,
       DATE_FORMAT(p.period_start,'%Y-%m-%d') period_start,DATE_FORMAT(p.period_end,'%Y-%m-%d') period_end,
       p.notes,e.name employee,by_user.name registered_by
       FROM employee_payments p JOIN users e ON e.id=p.employee_id
       JOIN users by_user ON by_user.id=p.registered_by
       ORDER BY p.pay_date DESC,p.id DESC LIMIT 500`));
  }));
  app.post('/api/finance/employee-payments', auth('admin', 'contador'), wrap(async (req, res) => {
    const { employee_id, amount, pay_date, period_start, period_end, notes = '' } = req.body;
    const employeeId = Number(employee_id), paymentAmount = Number(amount);
    const validDate = value => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
    };
    if (!Number.isInteger(employeeId) || employeeId < 1 || !Number.isFinite(paymentAmount) || paymentAmount <= 0 ||
      paymentAmount > 9999999999.99 || Math.abs(paymentAmount * 100 - Math.round(paymentAmount * 100)) > 1e-7 ||
      !validDate(pay_date) || !validDate(period_start) || !validDate(period_end) || period_start > period_end ||
      typeof notes !== 'string' || notes.length > 500) {
      throw fail(400, 'Empleado, monto, fecha y período válidos son obligatorios');
    }
    const result = await tx(async cn => {
      const [[employee]] = await cn.query("SELECT id,name FROM users WHERE id=? AND role<>'cliente' FOR UPDATE", [employeeId]);
      if (!employee) throw fail(404, 'No se encontró al empleado seleccionado');
      const concept = `Pago de empleado: ${employee.name} (${period_start} a ${period_end})`;
      const [expense] = await cn.query(
        "INSERT INTO expenses(concept,category,amount,date,user_id) VALUES(?,'Salarios',?,?,?)",
        [concept, paymentAmount, pay_date, req.user.id]);
      const [payment] = await cn.query(
        `INSERT INTO employee_payments(employee_id,amount,pay_date,period_start,period_end,notes,registered_by,expense_id)
         VALUES(?,?,?,?,?,?,?,?)`,
        [employeeId, paymentAmount, pay_date, period_start, period_end, notes || null, req.user.id, expense.insertId]);
      return { id: payment.insertId, expense_id: expense.insertId };
    });
    res.status(201).json(result);
  }));

  // ---------- Reportes CSV nuevos (se registran antes del genérico /api/reports/:kind) ----------
  const csv = rows => rows.length ? [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).map(v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; }).join(','))].join('\n') : '';
  const csvRoute = (kind, roles, sql) => app.get('/api/reports/' + kind, auth(...roles), wrap(async (_r, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename=${kind}.csv`); res.send('\uFEFF' + csv(await q(sql)));
  }));
  csvRoute('gastos', STAFF, 'SELECT date,category,concept,amount FROM expenses ORDER BY date DESC');
  csvRoute('compras', STAFF, 'SELECT p.number,c.name proveedor,p.status,p.total,p.due_date,p.paid_at FROM purchase_orders p JOIN contacts c ON c.id=p.supplier_id ORDER BY p.id DESC');
  csvRoute('accesos', ['admin'], 'SELECT l.at,u.name,l.email,l.ok,l.method,l.ip FROM login_log l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 5000');
  csvRoute('pagos-empleados', ['admin', 'contador'], `SELECT e.name empleado,p.amount,
    DATE_FORMAT(p.pay_date,'%Y-%m-%d') fecha_pago,DATE_FORMAT(p.period_start,'%Y-%m-%d') periodo_desde,
    DATE_FORMAT(p.period_end,'%Y-%m-%d') periodo_hasta,p.notes observaciones,by_user.name registrado_por
    FROM employee_payments p JOIN users e ON e.id=p.employee_id JOIN users by_user ON by_user.id=p.registered_by
    ORDER BY p.pay_date DESC,p.id DESC`);
}
