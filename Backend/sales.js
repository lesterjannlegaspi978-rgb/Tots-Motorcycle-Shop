const express = require("express");
const router = express.Router();
const db = require("./db");

router.post("/add", (req, res) => {
    const productId = Number(req.body.product_id);
    const quantity = Number(req.body.quantity);

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

    db.query(
        "SELECT id, product_name, price FROM products WHERE id = ?",
        [productId],
        (err, result) => {
            if (err) {
                console.error("GET PRODUCT ERROR:", err);

                return res.status(500).json({
                    success: false,
                    message: "Failed to retrieve product."
                });
            }

            if (result.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Product not found."
                });
            }

            const product = result[0];
            const total = Number(product.price) * quantity;

            db.query(
                `UPDATE products
                 SET quantity = quantity - ?
                 WHERE id = ?
                   AND quantity >= ?`,
                [quantity, productId, quantity],
                (stockErr, stockResult) => {
                    if (stockErr) {
                        console.error("STOCK UPDATE ERROR:", stockErr);

                        return res.status(500).json({
                            success: false,
                            message: "Failed to update inventory."
                        });
                    }

                    if (stockResult.affectedRows === 0) {
                        return res.status(400).json({
                            success: false,
                            message: "Insufficient stock."
                        });
                    }

                    db.query(
                        `INSERT INTO sales
                            (product_id, quantity, total)
                         VALUES (?, ?, ?)`,
                        [productId, quantity, total],
                        (saleErr, saleResult) => {
                            if (saleErr) {
                                console.error("SALE INSERT ERROR:", saleErr);

                                return db.query(
                                    `UPDATE products
                                     SET quantity = quantity + ?
                                     WHERE id = ?`,
                                    [quantity, productId],
                                    restoreErr => {
                                        if (restoreErr) {
                                            console.error(
                                                "STOCK RESTORE ERROR:",
                                                restoreErr
                                            );
                                        }

                                        return res.status(500).json({
                                            success: false,
                                            message: "Sale failed. Please verify inventory."
                                        });
                                    }
                                );
                            }

                            return res.json({
                                success: true,
                                message: "Sale completed.",
                                sale_id: saleResult.insertId,
                                product_name: product.product_name,
                                quantity,
                                total: Number(total.toFixed(2))
                            });
                        }
                    );
                }
            );
        }
    );
});

router.get("/all", (req, res) => {
    const sql = `
        SELECT
            sales.id,
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
        ORDER BY sales.sale_date DESC
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