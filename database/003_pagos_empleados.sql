USE bizmaster;

CREATE TABLE employee_payments(
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  pay_date DATE NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  notes VARCHAR(500) NULL,
  registered_by INT NOT NULL,
  expense_id INT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(employee_id) REFERENCES users(id),
  FOREIGN KEY(registered_by) REFERENCES users(id),
  FOREIGN KEY(expense_id) REFERENCES expenses(id)
);
