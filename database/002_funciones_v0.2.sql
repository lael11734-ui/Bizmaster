-- Ejecutar DESPUÉS de schema.sql (instalación nueva) o sobre una base existente de la v0.1.
USE bizmaster;
ALTER TABLE users MODIFY COLUMN role ENUM('admin','empleado','cliente','contador') NOT NULL DEFAULT 'empleado';
ALTER TABLE users ADD COLUMN pin_hash VARCHAR(100) NULL, ADD COLUMN require_bio TINYINT(1) NOT NULL DEFAULT 0;
CREATE TABLE webauthn_credentials(id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, cred_id VARCHAR(255) NOT NULL UNIQUE,
  public_key BLOB NOT NULL, counter INT NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE login_log(id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, email VARCHAR(160), ok TINYINT(1), method VARCHAR(20), ip VARCHAR(64), at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE purchase_orders(id INT AUTO_INCREMENT PRIMARY KEY, number VARCHAR(20), supplier_id INT NOT NULL, status ENUM('pendiente','recibida','anulada') NOT NULL DEFAULT 'pendiente',
  total DECIMAL(12,2) NOT NULL, due_date DATE, received_at DATETIME, paid_at DATETIME, user_id INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(supplier_id) REFERENCES contacts(id));
CREATE TABLE purchase_items(id INT AUTO_INCREMENT PRIMARY KEY, po_id INT NOT NULL, product_id INT NOT NULL, qty INT NOT NULL, unit_cost DECIMAL(12,2) NOT NULL,
  FOREIGN KEY(po_id) REFERENCES purchase_orders(id), FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE expenses(id INT AUTO_INCREMENT PRIMARY KEY, concept VARCHAR(200) NOT NULL, category VARCHAR(60), amount DECIMAL(12,2) NOT NULL, date DATE NOT NULL, user_id INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE cash_sessions(id INT AUTO_INCREMENT PRIMARY KEY, opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, opening DECIMAL(12,2) NOT NULL, closed_at DATETIME NULL,
  expected DECIMAL(12,2) NULL, counted DECIMAL(12,2) NULL, user_id INT);
