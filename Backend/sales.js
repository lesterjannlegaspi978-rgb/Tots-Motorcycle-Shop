const express = require("express");
const router = express.Router();
const db = require("./db");
const { publishUpdate } = require("./realtime");

class SaleError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function getConnection() {
    return new Promise((resolve, reject) => {
        if (typeof db.getConnection === "function") {
            db.getConnection((err, conn) => {
                if (err) return reject(err);
                resolve({ conn, release: () => conn.release() });
            });
        } else {
            resolve({ conn: db, release: () => {} });
        }
    });
}

function run(conn, sql, params = []) {
    return new Promise((resolve, reject) => {
        conn.query(sql, params, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

function begin(conn) {
    return new Promise((resolve, reject) => {
        conn.beginTransaction(err => (err ? reject(err) : resolve()));
    });
}

function commit(conn) {
    return new Promise((resolve, reject) => {
        conn.commit(err => (err ? reject(err) : resolve()));
    });
}

function rollback(conn) {
    return new Promise(resolve => {
        conn.rollback(() => resolve());
    });
}

router.post("/add", async (req, res) => {
    const rawItems = Array.isArray(req.body.items)
        ? req.body.items
        : [{ product_id: req.body.product_id, quantity: req.body.quantity }];

    if (rawItems.length === 0 || rawItems.length > 50) {
        return res.status(400).json({
            success: false,
            message: "Please add at least one product to the transaction."
        });
    }

    const merged = new Map();

    for (const item of rawItems) {
        const productId = Number(item && item.product_id);
        const quantity = Number(item && item.quantity);

        if (
            !Number.isInteger(productId) ||
            productId <= 0 ||
            !Number.isInteger(quantity) ||
            quantity <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid product and quantity."
            });
        }

        merged.set(productId, (merged.get(productId) || 0) + quantity);
    }

    const lines = Array.from(merged.entries()).sort((a, b) => a[0] - b[0]);

    let handle = null;

    try {
        handle = await getConnection();
        const conn = handle.conn;

        await begin(conn);

        let transactionId = null;
        let grandTotal = 0;
        const savedItems = [];

        for (const [productId, quantity] of lines) {
            const rows = await run(
                conn,
                `SELECT id, product_name, price, quantity
                 FROM products
                 WHERE id = ?
                 FOR UPDATE`,
                [productId]
            );

            if (rows.length === 0) {
                throw new SaleError(404, "Product not found.");
            }

            const product = rows[0];
            const stock = Number(product.quantity);

            if (stock < quantity) {
                throw new SaleError(
                    400,
                    "Insufficient stock for " + product.product_name +
                    ". Only " + stock + " pc(s) available."
                );
            }

            await run(
                conn,
                "UPDATE products SET quantity = quantity - ? WHERE id = ?",
                [quantity, productId]
            );

            const unitPrice = Number(product.price);
            const lineTotal = Number((unitPrice * quantity).toFixed(2));

            const inserted = await run(
                conn,
                `INSERT INTO sales
                    (product_id, quantity, total, transaction_id)
                 VALUES (?, ?, ?, ?)`,
                [productId, quantity, lineTotal, transactionId]
            );

            if (transactionId === null) {
                transactionId = inserted.insertId;

                await run(
                    conn,
                    "UPDATE sales SET transaction_id = ? WHERE id = ?",
                    [transactionId, inserted.insertId]
                );
            }

            grandTotal += lineTotal;

            savedItems.push({
                sale_id: inserted.insertId,
                product_id: productId,
                product_name: product.product_name,
                unit_price: unitPrice,
                quantity,
                total: lineTotal
            });
        }

        await commit(conn);

        publishUpdate(["sales", "inventory"]);

        return res.json({
            success: true,
            message: "Sale completed.",
            transaction_id: transactionId,
            sale_id: transactionId,
            items: savedItems,
            total: Number(grandTotal.toFixed(2))
        });
    } catch (err) {
        if (handle) {
            await rollback(handle.conn);
        }

        if (err instanceof SaleError) {
            return res.status(err.status).json({
                success: false,
                message: err.message
            });
        }

        console.error("RECORD SALE ERROR:", err);

        return res.status(500).json({
            success: false,
            message: "Sale failed. No changes were saved."
        });
    } finally {
        if (handle) {
            handle.release();
        }
    }
});

router.get("/all", (req, res) => {
    const sql = `
        SELECT
            sales.id,
            COALESCE(sales.transaction_id, sales.id) AS transaction_id,
            sales.product_id,
            products.product_name,
            sales.quantity,
            sales.total,
            DATE_FORMAT(
                sales.sale_date,
                '%b %d, %Y %h:%i %p'
            ) AS sale_date
        FROM sales
        JOIN products
            ON sales.product_id = products.id
        ORDER BY
            COALESCE(sales.transaction_id, sales.id) DESC,
            sales.id ASC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.error("GET ALL SALES ERROR:", err);

            return res.status(500).json({
                success: false,
                message: "Failed to load sales records."
            });
        }

        res.json(result);
    });
});

module.exports = router;