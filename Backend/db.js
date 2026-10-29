const mysql = require("mysql2");

const db = mysql.createConnection({
    host: process.env.DB_HOST || process.env.MYSQLHOST || "localhost",
    user: process.env.DB_USER || process.env.MYSQLUSER || "root",
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || "",
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || "tots_motorshop",
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const tableStatements = [
    ["admins", `
        CREATE TABLE IF NOT EXISTS admins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            fullname VARCHAR(150) NOT NULL,
            username VARCHAR(50) NOT NULL UNIQUE,
            email VARCHAR(100) NOT NULL UNIQUE,
            contact VARCHAR(20) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ["products", `
        CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_name VARCHAR(150) NOT NULL,
            category VARCHAR(100) NOT NULL,
            quantity INT NOT NULL DEFAULT 0,
            price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
            image TEXT,
            supplier_code VARCHAR(20) NOT NULL,
            supplier_name VARCHAR(150) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ["sales", `
        CREATE TABLE IF NOT EXISTS sales (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_id INT NOT NULL,
            quantity INT NOT NULL,
            total DECIMAL(10, 2) NOT NULL,
            sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sales_product_id (product_id),
            INDEX idx_sales_sale_date (sale_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ["suppliers", `
        CREATE TABLE IF NOT EXISTS suppliers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            supplier_code VARCHAR(20) NOT NULL UNIQUE,
            supplier_name VARCHAR(150) NOT NULL UNIQUE,
            contact_person VARCHAR(100) NOT NULL,
            contact_number VARCHAR(20) NOT NULL UNIQUE,
            email VARCHAR(254) NOT NULL UNIQUE,
            address VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ["purchase_orders", `
        CREATE TABLE IF NOT EXISTS purchase_orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            po_number VARCHAR(40) NOT NULL UNIQUE,
            supplier_id INT NOT NULL,
            order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(20) NOT NULL DEFAULT 'Pending',
            INDEX idx_purchase_orders_supplier_id (supplier_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ["purchase_order_items", `
        CREATE TABLE IF NOT EXISTS purchase_order_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            purchase_order_id INT NOT NULL,
            product_id INT NOT NULL,
            quantity INT NOT NULL,
            INDEX idx_po_items_purchase_order_id (purchase_order_id),
            INDEX idx_po_items_product_id (product_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ["stock_ins", `
        CREATE TABLE IF NOT EXISTS stock_ins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            stock_in_number VARCHAR(40) NOT NULL UNIQUE,
            purchase_order_id INT NOT NULL,
            supplier_id INT NOT NULL,
            stock_in_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(20) NOT NULL DEFAULT 'Completed',
            INDEX idx_stock_ins_purchase_order_id (purchase_order_id),
            INDEX idx_stock_ins_supplier_id (supplier_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ["stock_in_items", `
        CREATE TABLE IF NOT EXISTS stock_in_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            stock_in_id INT NOT NULL,
            product_id INT NOT NULL,
            quantity_received INT NOT NULL,
            unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
            INDEX idx_stock_in_items_stock_in_id (stock_in_id),
            INDEX idx_stock_in_items_product_id (product_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ["sales_returns", `
        CREATE TABLE IF NOT EXISTS sales_returns (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sale_id INT NOT NULL,
            product_id INT NOT NULL,
            quantity_returned INT NOT NULL,
            refund_amount DECIMAL(10, 2) NOT NULL,
            reason TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'Completed',
            return_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sales_returns_sale_id (sale_id),
            INDEX idx_sales_returns_product_id (product_id),
            INDEX idx_sales_returns_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ["refunds", `
        CREATE TABLE IF NOT EXISTS refunds (
            id INT AUTO_INCREMENT PRIMARY KEY,
            return_id INT NOT NULL,
            refund_amount DECIMAL(10, 2) NOT NULL,
            refund_method VARCHAR(30) NOT NULL DEFAULT 'Cash',
            status VARCHAR(20) NOT NULL DEFAULT 'Refunded',
            refund_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_refunds_return_id (return_id),
            INDEX idx_refunds_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `]
];

function createTable(name, sql) {
    return new Promise((resolve, reject) => {
        db.query(sql, error => {
            if (error) {
                reject(new Error(`Failed to create ${name} table: ${error.message}`));
                return;
            }

            console.log(`${name} table ready`);
            resolve();
        });
    });
}

db.ready = new Promise((resolve, reject) => {
    db.connect(error => {
        if (error) {
            reject(new Error(`Database connection failed: ${error.message}`));
            return;
        }

        console.log("MySQL Connected");
        resolve();
    });
}).then(async () => {
    for (const [name, sql] of tableStatements) {
        await createTable(name, sql);
    }
}).catch(error => {
    throw new Error(`Database initialization failed: ${error.message}`);
});

module.exports = db;