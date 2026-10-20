const mysql = require("mysql2");

const db = mysql.createConnection({
    host: process.env.DB_HOST || process.env.MYSQLHOST || "localhost",
    user: process.env.DB_USER || process.env.MYSQLUSER || "root",
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || "kaizer28",
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || "tots_motorshop",
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.connect((err) => {
    if (err) {
        console.log("Database Error:", err);
        return;
    }

    console.log("MySQL Connected");

    const createAdminsTableSql = `
        CREATE TABLE IF NOT EXISTS admins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            fullname VARCHAR(150) NOT NULL,
            username VARCHAR(50) NOT NULL UNIQUE,
            email VARCHAR(100) NOT NULL UNIQUE,
            contact VARCHAR(20) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(createAdminsTableSql, (tableErr) => {
        if (tableErr) {
            console.log("Failed to create admins table:", tableErr);
        } else {
            console.log("Admins table ready");
        }
    });
});

module.exports = db;