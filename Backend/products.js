
const express = require('express');
const router = express.Router();
const db = require('./db');

// ADD PRODUCT
router.post('/add', (req, res) => {
    const {
        product_name,
        category,
        quantity,
        price,
        image,
        supplier_code,
        supplier_name
    } = req.body;

    if (
        !product_name ||
        !category ||
        quantity === undefined ||
        price === undefined ||
        !supplier_code ||
        !supplier_name
    ) {
        return res.status(400).json({
            success: false,
            message: "Please fill in all fields."
        });
    }

    const checkSql = `
        SELECT id
        FROM products
        WHERE product_name = ?
        LIMIT 1
    `;

    db.query(checkSql, [product_name], (err, result) => {
        if (err) {
            console.error("CHECK PRODUCT ERROR:", err);

            return res.status(500).json({
                success: false,
                message: "Unable to check existing product."
            });
        }

        if (result.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Product already exists!"
            });
        }

        const sql = `
            INSERT INTO products (
                product_name,
                category,
                quantity,
                price,
                image,
                supplier_code,
                supplier_name
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(
            sql,
            [
                product_name,
                category,
                Number(quantity),
                Number(price),
                image || "",
                supplier_code,
                supplier_name
            ],
            (err, result) => {
                if (err) {
                    console.error("ADD PRODUCT ERROR:", err);

                    return res.status(500).json({
                        success: false,
                        message: "Unable to save product."
                    });
                }

                console.log(
                    "Product added. Database ID:",
                    result.insertId
                );

                return res.status(201).json({
                    success: true,
                    message: "Product Saved Successfully!",
                    id: result.insertId
                });
            }
        );
    });
});

// GET ALL PRODUCTS WITH SHARED DISPLAY NUMBER
router.get('/all', (req, res) => {
    const sql = `
        SELECT
            ROW_NUMBER() OVER (ORDER BY id ASC) AS product_no,
            id,
            product_name,
            category,
            quantity,
            price,
            image,
            supplier_code,
            supplier_name
        FROM products
        ORDER BY id ASC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.error("LOAD PRODUCTS ERROR:", err);

            return res.status(500).json({
                success: false,
                message: "Unable to load products."
            });
        }

        return res.json(result);
    });
});

// DELETE PRODUCT
router.delete('/delete/:id', (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid product ID."
        });
    }

    const sql = "DELETE FROM products WHERE id = ?";

    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error("DELETE PRODUCT ERROR:", err);

            return res.status(500).json({
                success: false,
                message:
                    "Delete failed. Check whether this product is referenced by existing records."
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Product not found."
            });
        }

        return res.json({
            success: true,
            message: "Product Deleted Successfully"
        });
    });
});

// UPDATE PRODUCT
router.put('/update/:id', (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid product ID."
        });
    }

    const {
        product_name,
        category,
        quantity,
        price,
        image,
        supplier_code,
        supplier_name
    } = req.body;

    if (
        !product_name ||
        !category ||
        quantity === undefined ||
        price === undefined ||
        !supplier_code ||
        !supplier_name
    ) {
        return res.status(400).json({
            success: false,
            message: "Please fill in all fields."
        });
    }

    const sql = `
        UPDATE products
        SET
            product_name = ?,
            category = ?,
            quantity = ?,
            price = ?,
            image = ?,
            supplier_code = ?,
            supplier_name = ?
        WHERE id = ?
    `;

    db.query(
        sql,
        [
            product_name,
            category,
            Number(quantity),
            Number(price),
            image || "",
            supplier_code,
            supplier_name,
            id
        ],
        (err, result) => {
            if (err) {
                console.error("UPDATE PRODUCT ERROR:", err);

                return res.status(500).json({
                    success: false,
                    message: "Unable to update product."
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Product not found or no changes were made."
                });
            }

            return res.json({
                success: true,
                message: "Product Updated Successfully"
            });
        }
    );
});

module.exports = router;
