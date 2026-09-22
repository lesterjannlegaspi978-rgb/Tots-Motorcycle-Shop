const express = require("express");
const router = express.Router();
const db = require("./db");

router.post("/add", (req, res) => {

    const { product_id, quantity } = req.body;

    const getProduct =
    "SELECT * FROM products WHERE id = ?";

    db.query(getProduct, [product_id], (err, result) => {

        if (err || result.length === 0) {
            return res.send({
                success: false,
                message: "Product not found"
            });
        }

        const product = result[0];

        if (product.quantity < quantity) {
            return res.send({
                success: false,
                message: "Insufficient stock"
            });
        }

        const total = product.price * quantity;

        db.query(
            `INSERT INTO sales(product_id, quantity, total)
             VALUES (?, ?, ?)`,
            [product_id, quantity, total],
            (err2) => {

                if (err2) {
                    return res.send({
                        success: false,
                        message: "Sale Failed"
                    });
                }

                db.query(
                    `UPDATE products
                     SET quantity = quantity - ?
                     WHERE id = ?`,
                    [quantity, product_id]
                );

                res.send({
                    success: true,
                    message: "Sale Completed"
                });
            }
        );
    });
});

router.get("/all", (req, res) => {

    const sql = `
    SELECT
        sales.id,
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
            console.log(err);
            return res.send([]);
        }

        res.send(result);
    });
});

module.exports = router;