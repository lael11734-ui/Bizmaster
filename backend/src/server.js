import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountExtra } from './extra.js';

const pool = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQLHOST,
  port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
  user: process.env.DB_USER || process.env.MYSQLUSER,
  password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD,
  database: process.env.DB_NAME || process.env.MYSQLDATABASE,
  waitForConnections: true,
});
const q = async (sql, p = []) => (await pool.query(sql, p))[0];
const app = express();
app.use(helmet(), cors({ origin: process.env.CORS_ORIGIN }), express.json());

const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Error interno' }); });
const verify = req => jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET);
const auth = (...roles) => (req, res, next) => {
  try { req.user = verify(req); } catch { return res.status(401).json({ error: 'No autenticado' }); }
  if (req.user.purpose) return res.status(401).json({ error: 'No autenticado' });
  if (req.user.enroll && !req.originalUrl.startsWith('/api/me/biometric')) return res.status(403).json({ error: 'Debes registrar tu huella o rostro primero', enroll: true });
  if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Sin permiso para este módulo' });
  next();
};
const STAFF = ['admin', 'empleado', 'contador'];
mountExtra(app, { q, pool, auth, wrap, STAFF }); // v0.2: rutas nuevas (el login nuevo reemplaza al anterior)

// ---- Autenticación ----
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password, role = 'empleado' } = req.body;
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'Nombre, correo y contraseña (mín. 8) son obligatorios' });
  const [{ n }] = await q('SELECT COUNT(*) n FROM users');
  let r = 'admin';
  if (n > 0) {
    try { if (verify(req).role !== 'admin') throw 0; } catch { return res.status(403).json({ error: 'Solo un administrador puede crear usuarios' }); }
    r = ['admin', 'empleado', 'cliente', 'contador'].includes(role) ? role : 'empleado';
  }
  await q('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)', [name, email, await bcrypt.hash(password, 12), r]);
  res.status(201).json({ ok: true, role: r });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const [u] = await q('SELECT * FROM users WHERE email=?', [req.body.email]);
  if (!u || !(await bcrypt.compare(req.body.password || '', u.password_hash))) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  const token = jwt.sign({ id: u.id, role: u.role, name: u.name }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { name: u.name, role: u.role } });
}));

app.get('/api/health', wrap(async (_req, res) => {
  await q('SELECT 1');
  res.json({ status: 'ok' });
}));

// ---- Dashboard ----
app.get('/api/dashboard', auth(...STAFF), wrap(async (_req, res) => {
  const [today] = await q('SELECT COALESCE(SUM(total),0) v FROM invoices WHERE DATE(created_at)=CURDATE()');
  const [month] = await q('SELECT COALESCE(SUM(total),0) v FROM invoices WHERE YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())');
  const [cl] = await q("SELECT COUNT(*) v FROM contacts WHERE type='cliente'");
  const low = await q('SELECT id,sku,name,stock,min_stock FROM products WHERE stock<=min_stock ORDER BY stock');
  const monthly = await q("SELECT DATE_FORMAT(created_at,'%Y-%m') m, SUM(total) v FROM invoices GROUP BY m ORDER BY m DESC LIMIT 6");
  res.json({ today: today.v, month: month.v, clients: cl.v, low, monthly: monthly.reverse() });
}));

// ---- Inventario ----
app.get('/api/products', auth(...STAFF), wrap(async (_q, res) => res.json(await q('SELECT * FROM products ORDER BY name'))));
app.get('/api/products/search', auth(...STAFF), wrap(async (req, res) => {
  const qv = String(req.query.q || '').trim();
  if (!qv) return res.json([]);
  const rows = await q('SELECT * FROM products WHERE barcode=? OR sku=? OR LOWER(name) LIKE ? ORDER BY name LIMIT 20', [qv, qv, `%${qv.toLowerCase()}%`]);
  res.json(rows);
}));
app.get('/api/activity', auth(...STAFF), wrap(async (_req, res) => {
  res.json(await q(`SELECT activity.type,activity.description,activity.created_at,activity.user
    FROM (
      SELECT CASE WHEN m.qty > 0 THEN 'Entrada' ELSE 'Salida' END type,
        CONCAT(p.name,' (',ABS(m.qty),' unidades)') description,m.created_at,u.name user
      FROM stock_moves m JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.user_id
      UNION ALL
      SELECT 'Venta' type,CONCAT(i.number,' · ',c.name) description,i.created_at,u.name user
      FROM invoices i JOIN contacts c ON c.id=i.contact_id LEFT JOIN users u ON u.id=i.user_id
    ) activity
    ORDER BY activity.created_at DESC LIMIT 8`));
}));
app.post('/api/products', auth(...STAFF), wrap(async (req, res) => {
  const { sku, barcode, name, price, stock = 0, min_stock = 5 } = req.body;
  if (!sku || !name || !(price >= 0)) return res.status(400).json({ error: 'SKU, nombre y precio válidos son obligatorios' });
  const [dup] = await q('SELECT id FROM products WHERE sku=? OR (barcode IS NOT NULL AND barcode=?) LIMIT 1', [sku, barcode || null]);
  if (dup) return res.status(409).json({ error: 'Ya existe un producto con este SKU o código de barras' });
  const r = await q('INSERT INTO products(sku,barcode,name,price,stock,min_stock) VALUES(?,?,?,?,?,?)', [sku, barcode || null, name, price, stock, min_stock]);
  if (stock) await q('INSERT INTO stock_moves(product_id,qty,reason,user_id) VALUES(?,?,?,?)', [r.insertId, stock, 'entrada inicial', req.user.id]);
  res.status(201).json({ id: r.insertId });
}));
app.put('/api/products/:id', auth(...STAFF), wrap(async (req, res) => {
  const { sku, barcode, name, price, stock = 0, min_stock = 5 } = req.body;
  if (!sku || !name || !Number.isFinite(Number(price)) || Number(price) < 0 ||
    !Number.isInteger(Number(stock)) || Number(stock) < 0 ||
    !Number.isInteger(Number(min_stock)) || Number(min_stock) < 0) {
    return res.status(400).json({ error: 'SKU, nombre, precio y existencias válidos son obligatorios' });
  }
  const [current] = await q('SELECT id,stock FROM products WHERE id=?', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Producto no encontrado' });
  const [duplicate] = await q('SELECT id FROM products WHERE (sku=? OR barcode=?) AND id<>? LIMIT 1', [sku, barcode || null, req.params.id]);
  if (duplicate) return res.status(409).json({ error: 'Ya existe otro producto con este SKU o código de barras' });
  await q('UPDATE products SET sku=?,barcode=?,name=?,price=?,stock=?,min_stock=? WHERE id=?',
    [sku, barcode || null, name, Number(price), Number(stock), Number(min_stock), req.params.id]);
  const difference = Number(stock) - Number(current.stock);
  if (difference) await q('INSERT INTO stock_moves(product_id,qty,reason,user_id) VALUES(?,?,?,?)',
    [req.params.id, difference, 'actualización de producto', req.user.id]);
  res.json({ ok: true });
}));
app.post('/api/products/:id/stock', auth(...STAFF), wrap(async (req, res) => {
  const qty = parseInt(req.body.qty, 10);
  if (!qty) return res.status(400).json({ error: 'Cantidad inválida (use negativo para salidas)' });
  await q('UPDATE products SET stock=stock+? WHERE id=?', [qty, req.params.id]);
  await q('INSERT INTO stock_moves(product_id,qty,reason,user_id) VALUES(?,?,?,?)', [req.params.id, qty, req.body.reason || 'ajuste', req.user.id]);
  res.json({ ok: true });
}));

// ---- Clientes y proveedores ----
app.get('/api/contacts', auth(...STAFF), wrap(async (req, res) =>
  res.json(await q('SELECT * FROM contacts WHERE (? IS NULL OR type=?) ORDER BY name', [req.query.type || null, req.query.type || null]))));
app.post('/api/contacts', auth(...STAFF), wrap(async (req, res) => {
  const { type = 'cliente', name, nit, email, phone, category, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const r = await q('INSERT INTO contacts(type,name,nit,email,phone,category,notes) VALUES(?,?,?,?,?,?,?)', [type, name, nit, email, phone, category, notes]);
  res.status(201).json({ id: r.insertId });
}));
app.get('/api/contacts/:id/history', auth(...STAFF), wrap(async (req, res) =>
  res.json(await q('SELECT id,number,total,created_at FROM invoices WHERE contact_id=? ORDER BY id DESC', [req.params.id]))));

// ---- Facturación (IVA 13%) ----
app.get('/api/invoices', auth(...STAFF), wrap(async (_q, res) =>
  res.json(await q('SELECT i.id,i.number,i.total,i.created_at,c.name customer FROM invoices i JOIN contacts c ON c.id=i.contact_id ORDER BY i.id DESC LIMIT 200'))));

app.post('/api/invoices', auth(...STAFF), wrap(async (req, res) => {
  const { contact_id, items } = req.body;
  if (!contact_id || !Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Cliente y al menos un producto son obligatorios' });
  const cn = await pool.getConnection();
  try {
    await cn.beginTransaction();
    let subtotal = 0; const lines = [];
    for (const it of items) {
      const [[p]] = await cn.query('SELECT * FROM products WHERE id=? FOR UPDATE', [it.product_id]);
      const qty = parseInt(it.qty, 10);
      if (!p || !(qty > 0)) throw Object.assign(new Error('Producto o cantidad inválidos'), { status: 400 });
      if (p.stock < qty) throw Object.assign(new Error(`Stock insuficiente de ${p.name} (disponible: ${p.stock})`), { status: 409 });
      subtotal += p.price * qty; lines.push({ p, qty });
    }
    subtotal = Math.round(subtotal * 100) / 100;
    const iva = Math.round(subtotal * 0.13 * 100) / 100, total = Math.round((subtotal + iva) * 100) / 100;
    const [inv] = await cn.query('INSERT INTO invoices(contact_id,user_id,subtotal,iva,total) VALUES(?,?,?,?,?)', [contact_id, req.user.id, subtotal, iva, total]);
    const number = 'F-' + String(inv.insertId).padStart(8, '0');
    await cn.query('UPDATE invoices SET number=? WHERE id=?', [number, inv.insertId]);
    for (const { p, qty } of lines) {
      await cn.query('INSERT INTO invoice_items(invoice_id,product_id,qty,unit_price) VALUES(?,?,?,?)', [inv.insertId, p.id, qty, p.price]);
      await cn.query('UPDATE products SET stock=stock-? WHERE id=?', [qty, p.id]);
      await cn.query('INSERT INTO stock_moves(product_id,qty,reason,user_id) VALUES(?,?,?,?)', [p.id, -qty, 'venta ' + number, req.user.id]);
    }
    await cn.commit();
    // TODO DTE: aquí firmar y transmitir a Hacienda (El Salvador) antes de responder.
    res.status(201).json({ id: inv.insertId, number, total });
  } catch (e) { await cn.rollback(); throw e; } finally { cn.release(); }
}));

app.get('/api/invoices/:id/pdf', auth(...STAFF), wrap(async (req, res) => {
  const [inv] = await q('SELECT i.*,c.name cname,c.nit FROM invoices i JOIN contacts c ON c.id=i.contact_id WHERE i.id=?', [req.params.id]);
  if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
  const items = await q('SELECT ii.qty,ii.unit_price,p.name FROM invoice_items ii JOIN products p ON p.id=ii.product_id WHERE invoice_id=?', [inv.id]);
  const d = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=${inv.number}.pdf`);
  d.pipe(res);
  d.fontSize(20).fillColor('#1d4ed8').text('BizMaster LAEL').fontSize(10).fillColor('#475569').text('Documento interno (no sustituye al DTE de Hacienda)').moveDown();
  d.fillColor('#000').fontSize(12).text(`Factura ${inv.number}`).text(`Cliente: ${inv.cname}  NIT: ${inv.nit || '-'}`).text(`Fecha: ${new Date(inv.created_at).toLocaleString('es-SV')}`).moveDown();
  items.forEach(i => d.text(`${i.qty} x ${i.name}   $${Number(i.unit_price).toFixed(2)}   = $${(i.qty * i.unit_price).toFixed(2)}`));
  d.moveDown().text(`Subtotal: $${Number(inv.subtotal).toFixed(2)}`).text(`IVA 13%: $${Number(inv.iva).toFixed(2)}`).fontSize(14).text(`TOTAL: $${Number(inv.total).toFixed(2)}`);
  d.end();
}));

// ---- Reportes (CSV, abre en Excel) ----
const csv = rows => rows.length ? [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).map(v => {
  let value = String(v ?? '');
  if (/^[=+\-@]/.test(value)) value = "'" + value;
  return `"${value.replace(/"/g, '""')}"`;
}).join(','))].join('\n') : '';
app.get('/api/reports/:kind', auth(...STAFF), wrap(async (req, res) => {
  const k = req.params.kind;
  const rows = k === 'ventas' ? await q(`SELECT i.number factura,i.created_at fecha,COALESCE(u.name,'Vendedor no identificado') vendedor,
    c.name cliente,GROUP_CONCAT(CONCAT(p.sku,' - ',p.name,' (',ii.qty,')') ORDER BY ii.id SEPARATOR '; ') productos,
    i.subtotal,i.iva,i.total
    FROM invoices i JOIN contacts c ON c.id=i.contact_id
    LEFT JOIN users u ON u.id=i.user_id
    JOIN invoice_items ii ON ii.invoice_id=i.id
    JOIN products p ON p.id=ii.product_id
    GROUP BY i.id,i.number,i.created_at,u.name,c.name,i.subtotal,i.iva,i.total
    ORDER BY i.created_at,i.id`)
    : k === 'inventario' ? await q('SELECT sku,name,price,stock,min_stock FROM products ORDER BY name')
    : k === 'movimientos' ? await q('SELECT m.created_at,p.sku,p.name,m.qty,m.reason FROM stock_moves m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC') : null;
  if (!rows) return res.status(404).json({ error: 'Reporte no existe' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${k}.csv`);
  res.send('\uFEFF' + csv(rows));
}));

if (process.env.NODE_ENV === 'production') {
  const appDir = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(appDir, '../public');
  app.use(express.static(publicDir));
  app.get(/^\/(?!api(?:\/|$)).*/, (_req, res, next) => {
    res.sendFile(path.join(publicDir, 'index.html'), error => error && next(error));
  });
}

app.listen(process.env.PORT || 4000, () => console.log('BizMaster LAEL API lista'));
