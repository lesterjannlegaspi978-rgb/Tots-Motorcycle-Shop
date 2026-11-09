
const express = require('express');
const router = express.Router();
const db = require('./db');

function validateProduct(body) {
    const {
        product_name,
        category,
        quantity,
        price,
        supplier_code
    } = body;

    if (
        !String(product_name || '').trim() ||
        !String(category || '').trim() ||
        quantity === undefined ||
        quantity === '' ||
        price === undefined ||
        price === '' ||
        !String(supplier_code || '').trim()
    ) {
        return "Please fill in all fields.";
    }

    if (!Number.isInteger(Number(quantity)) || Number(quantity) < 0) {
        return "Stock must be a valid whole number greater than or equal to zero.";
    }

    if (!Number.isFinite(Number(price)) || Number(price <= 0)) {
        return "Please enter a valid product price.";
    }

    return null;
}

function getSupplier(supplierCode, callback) {
    const sql = `
        SELECT supplier_code, supplier_name
        FROM suppliers
        WHERE supplier_code = ?
        LIMIT 1
    `;

    db.query(sql, [supplierCode], (err, result) => {
        if (err) {
            return callback(err);
        }

        if (result.length === 0) {
            return callback(null, null);
        }

        callback(null, result[0]);
    });
}

router.post('/add', (req, res) => {
    const {
        product_name,
        category,
        quantity,
        price,
        image,
        supplier_code
    } = req.body;

    const validationError = validateProduct(req.body);

    if (validationError) {
        return res.status(400).json({
            success: false,
            message: validationError
        });
    }

    const cleanName = String(product_name).trim();
    const cleanCategory = String(category).trim();
    const cleanSupplierCode = String(supplier_code).trim().toUpperCase();

    const checkSql = `
        SELECT id
        FROM products
        WHERE LOWER(product_name) = LOWER(?)
        LIMIT 1
    `;

    db.query(checkSql, [cleanName], (err, result) => {
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

        getSupplier(cleanSupplierCode, (supplierError, supplier) => {
            if (supplierError) {
                console.error("CHECK SUPPLIER ERROR:", supplierError);

                return res.status(500).json({
                    success: false,
                    message: "Unable to verify selected supplier."
                });
            }

            if (!supplier) {
                return res.status(400).json({
                    success: false,
                    message: "Selected supplier does not exist. Please select a registered supplier."
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
                    cleanName,
                    cleanCategory,
                    Number(quantity),
                    Number(price),
                    image || "",
                    supplier.supplier_code,
                    supplier.supplier_name
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
});

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
        supplier_code
    } = req.body;

    const validationError = validateProduct(req.body);

    if (validationError) {
        return res.status(400).json({
            success: false,
            message: validationError
        });
    }

    const cleanName = String(product_name).trim();
    const cleanCategory = String(category).trim();
    const cleanSupplierCode = String(supplier_code).trim().toUpperCase();

    const checkProductSql = `
        SELECT id
        FROM products
        WHERE LOWER(product_name) = LOWER(?)
        AND id <> ?
        LIMIT 1
    `;

    db.query(checkProductSql, [cleanName, id], (err, duplicate) => {
        if (err) {
            console.error("CHECK DUPLICATE PRODUCT ERROR:", err);

            return res.status(500).json({
                success: false,
                message: "Unable to check existing product."
            });
        }

        if (duplicate.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Another product already uses this name."
            });
        }

        getSupplier(cleanSupplierCode, (supplierError, supplier) => {
            if (supplierError) {
                console.error("CHECK SUPPLIER ERROR:", supplierError);

                return res.status(500).json({
                    success: false,
                    message: "Unable to verify selected supplier."
                });
            }

            if (!supplier) {
                return res.status(400).json({
                    success: false,
                    message: "Selected supplier does not exist. Please select a registered supplier."
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
                    cleanName,
                    cleanCategory,
                    Number(quantity),
                    Number(price),
                    image || "",
                    supplier.supplier_code,
                    supplier.supplier_name,
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
                        return db.query(
                            "SELECT id FROM products WHERE id = ?",
                            [id],
                            (checkError, existing) => {
                                if (checkError) {
                                    return res.status(500).json({
                                        success: false,
                                        message: "Unable to verify product."
                                    });
                                }

                                if (existing.length === 0) {
                                    return res.status(404).json({
                                        success: false,
                                        message: "Product not found."
                                    });
                                }

                                return res.json({
                                    success: true,
                                    message: "Product Updated Successfully!"
                                });
                            }
                        );
                    }

                    return res.json({
                        success: true,
                        message: "Product Updated Successfully!"
                    });
                }
            );
        });
    });
});

module.exports = router;
