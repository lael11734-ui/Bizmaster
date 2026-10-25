# BizMaster LAEL
Propiedad de Luis Ángel Escobar Leiva (LAEL). Versión MVP (prueba).

**Versión 0.2.0.** Incluye: autenticación con roles (admin/empleado/cliente), dashboard, inventario con alertas de stock bajo,
clientes y proveedores (CRM con notas), facturas con IVA 13% y PDF, y reportes CSV (abre en Excel).

## Requisitos
Node 18+ y MySQL 8.

## Puesta en marcha
1. Ejecuta en orden: `mysql -u root -p < database/schema.sql`, `mysql -u root -p < database/002_funciones_v0.2.sql` y `mysql -u root -p < database/003_pagos_empleados.sql`.
2. `cd backend && cp .env.example .env` (edita credenciales y JWT_SECRET) `&& npm install && npm start`
3. `cd frontend && npm install && npm run dev` → http://localhost:5173
4. El primer usuario que se registre queda como **administrador**. Después, solo un admin crea usuarios.

## Preparar una demo en Railway
- El `Dockerfile` y `railway.toml` de la raíz permiten desplegar frontend y API en un mismo servicio; agrega también un servicio MySQL.
- Inicializa la base de datos ejecutando, en orden, `database/schema.sql`, `database/002_funciones_v0.2.sql` y `database/003_pagos_empleados.sql`. Los scripts crean/usan una base llamada `bizmaster`.
- Configura los datos privados de conexión MySQL en `DB_HOST`, `DB_USER`, `DB_PASSWORD` y `DB_NAME=bizmaster` (o usa las variables `MYSQLHOST`, `MYSQLUSER`, `MYSQLPASSWORD` y `MYSQLDATABASE`; en ese caso, `MYSQLDATABASE` debe ser `bizmaster`). Define `JWT_SECRET` como un valor aleatorio y largo.
- Cuando tengas el dominio HTTPS asignado, configura `RP_ID` con el dominio sin `https://` y `ORIGIN` con el origen completo para habilitar huella/rostro.
- El primer usuario registrado obtiene rol de administrador. Inicializa la cuenta de demo antes de compartir el dominio y no uses datos reales.
- No subas `backend/.env` ni compartas secretos; el `.dockerignore` los excluye de la imagen.

## Publicar solo la interfaz en Vercel
- Importa el repositorio en Vercel y configura **Root Directory** como `frontend`; allí ya están `vercel.json` y la configuración de Vite.
- La API y MySQL deben estar desplegados por separado (por ejemplo, API en Railway y una base MySQL privada). No pongas credenciales de base de datos en variables `VITE_*`.
- En Vercel, agrega `VITE_API_URL` con la URL HTTPS de la API incluyendo `/api`, por ejemplo `https://tu-api.up.railway.app/api`, y vuelve a desplegar.
- En el servicio de API, agrega el dominio Vercel exacto a `CORS_ORIGIN`. Para biometría, configura `ORIGIN` al origen HTTPS de Vercel y `RP_ID` al hostname, sin protocolo ni ruta.
- Registra la primera cuenta de administrador solo después de confirmar que el servicio API ya está conectado a la base de datos de demo. El dominio Vercel publica la interfaz; no contiene ni migra los datos de prueba locales.

## Pendiente para producción (fases siguientes)
- **Facturación electrónica de Hacienda (DTE)**: hoy se genera PDF interno; falta firma, transmisión y
  contingencia con el API de Hacienda. Valídalo con un contador. Punto de integración: `POST /api/invoices` en `backend/src/server.js`.
- Pasarela de pagos (usar checkout alojado, nunca guardar tarjetas), agenda/push, marketplace, multilenguaje.
- HTTPS, límite de intentos de login, respaldos, revisión legal de las leyes aplicables.

## Novedades v0.2.0
- **Seguridad:** PIN generado por el administrador (se muestra una vez y puede enviarse por correo), huella/rostro del dispositivo (WebAuthn: Face ID, Windows Hello, lector de huella), opción de exigirla por usuario, registro de hora de cada entrada (y de los intentos fallidos) y bloqueo tras 5 fallos en 15 minutos.
- **Facturas:** imprimir y enviar por correo con PDF adjunto (configura SMTP en `backend/.env`).
- **Compras:** órdenes de compra, recepción que suma al inventario, cuentas por pagar y registro de pago.
- **Caja y gastos:** apertura y cierre de caja con diferencia, gastos por categoría.
- **Finanzas (administrador y contador):** ventas, IVA, gastos, utilidad en base de caja, cuentas por pagar y registro de pagos manuales de empleados. Los pagos se agregan como gasto de salarios y pueden exportarse a CSV para Excel.
- **Ventas por vendedor:** reporte CSV descargable con cada factura, vendedor, cliente, productos, subtotal, IVA y total; incluye todo el historial registrado y se abre en Excel.

Notas: la huella/rostro requiere HTTPS (o localhost) y que `RP_ID` y `ORIGIN` del `.env` coincidan con tu dominio. Los pagos de compras salen como gasto; las ventas se asumen en efectivo para el cuadre de caja.
Pendiente: DTE de Hacienda, pasarela de pagos, agenda/push, multilenguaje, portal de cliente.
