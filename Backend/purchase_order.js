const express = require("express");
const router = express.Router();
const db = require("./db");

router.get("/suppliers", (req, res) => {

    const sql = `
        SELECT
            id,
            supplier_code,
            supplier_name,
            contact_person,
            contact_number,
            email,
            address
        FROM suppliers
        ORDER BY supplier_name ASC
    `;

    db.query(sql, (err, results) => {

        if (err) {

            console.error(
                "Purchase Order - Suppliers Error:",
                err
            );

            return res.status(500).json({
                success: false,
                message: "Failed to load suppliers."
            });

        }

        res.json(results);

    });

});

router.get("/products", (req, res) => {

    const sql = `
        SELECT
            id,
            product_name,
            category,
            quantity,
            price,
            image,
            supplier_code,
            supplier_name
        FROM products
        ORDER BY product_name ASC
    `;

    db.query(sql, (err, results) => {

        if (err) {

            console.error(
                "Purchase Order - Products Error:",
                err
            );

            return res.status(500).json({
                success: false,
                message: "Failed to load products."
            });

        }

        res.json(results);

    });

});

router.post("/create", (req, res) => {

    let {
        supplier_id,
        items
    } = req.body;

    supplier_id = Number(supplier_id);

    if (
        !Number.isInteger(supplier_id) ||
        supplier_id <= 0
    ) {

        return res.status(400).json({
            success: false,
            message: "Please select a valid supplier."
        });

    }


    if (!Array.isArray(items) || items.length === 0) {

        return res.status(400).json({
            success: false,
            message: "Please add at least one product to the Purchase Order."
        });

    }

    const cleanedItems = [];

    const usedProductIds = new Set();


    for (const item of items) {

        const product_id = Number(item.product_id);
        const quantity = Number(item.quantity);


        if (
            !Number.isInteger(product_id) ||
            product_id <= 0
        ) {

            return res.status(400).json({
                success: false,
                message: "Invalid product selected."
            });

        }


        if (
            !Number.isInteger(quantity) ||
            quantity <= 0
        ) {

            return res.status(400).json({
                success: false,
                message: "Product quantity must be a whole number greater than 0."
            });

        }

        if (usedProductIds.has(product_id)) {

            return res.status(400).json({
                success: false,
                message: "A product cannot be added more than once in the same Purchase Order."
            });

        }


        usedProductIds.add(product_id);


        cleanedItems.push({
            product_id,
            quantity
        });

    }

    db.beginTransaction((transactionError) => {

        if (transactionError) {

            console.error(
                "Purchase Order Transaction Error:",
                transactionError
            );

            return res.status(500).json({
                success: false,
                message: "Unable to start Purchase Order transaction."
            });

        }

        const supplierSql = `
            SELECT
                id,
                supplier_code,
                supplier_name
            FROM suppliers
            WHERE id = ?
            LIMIT 1
        `;


        db.query(
            supplierSql,
            [supplier_id],
            (supplierError, supplierResults) => {

                if (supplierError) {

                    return db.rollback(() => {

                        console.error(
                            "Supplier Check Error:",
                            supplierError
                        );

                        res.status(500).json({
                            success: false,
                            message: "Failed to verify supplier."
                        });

                    });

                }


                if (supplierResults.length === 0) {

                    return db.rollback(() => {

                        res.status(400).json({
                            success: false,
                            message: "Selected supplier does not exist."
                        });

                    });

                }

                const productIds =
                    cleanedItems.map(
                        item => item.product_id
                    );


                const placeholders =
                    productIds
                        .map(() => "?")
                        .join(",");


                const productSql = `
                    SELECT
                        id,
                        product_name,
                        category,
                        price
                    FROM products
                    WHERE id IN (${placeholders})
                `;


                db.query(
                    productSql,
                    productIds,
                    (productError, productResults) => {

                        if (productError) {

                            return db.rollback(() => {

                                console.error(
                                    "Product Check Error:",
                                    productError
                                );

                                res.status(500).json({
                                    success: false,
                                    message: "Failed to verify products."
                                });

                            });

                        }

                        if (
                            productResults.length !==
                            cleanedItems.length
                        ) {

                            return db.rollback(() => {

                                res.status(400).json({
                                    success: false,
                                    message: "One or more selected products do not exist."
                                });

                            });

                        }

                        const temporaryPoNumber =
                            `TEMP-${Date.now()}-${Math.floor(
                                Math.random() * 100000
                            )}`;


                        const insertPoSql = `
                            INSERT INTO purchase_orders
                            (
                                po_number,
                                supplier_id,
                                status
                            )
                            VALUES
                            (
                                ?,
                                ?,
                                'Pending'
                            )
                        `;


                        db.query(
                            insertPoSql,
                            [
                                temporaryPoNumber,
                                supplier_id
                            ],
                            (poError, poResult) => {

                                if (poError) {

                                    return db.rollback(() => {

                                        console.error(
                                            "Create Purchase Order Error:",
                                            poError
                                        );

                                        res.status(500).json({
                                            success: false,
                                            message: "Failed to create Purchase Order."
                                        });

                                    });

                                }


                                const purchaseOrderId =
                                    poResult.insertId;

                                const finalPoNumber =
                                    `PO-${String(
                                        purchaseOrderId
                                    ).padStart(4, "0")}`;


                                const updatePoNumberSql = `
                                    UPDATE purchase_orders
                                    SET po_number = ?
                                    WHERE id = ?
                                `;


                                db.query(
                                    updatePoNumberSql,
                                    [
                                        finalPoNumber,
                                        purchaseOrderId
                                    ],
                                    (updatePoError) => {

                                        if (updatePoError) {

                                            return db.rollback(() => {

                                                console.error(
                                                    "PO Number Update Error:",
                                                    updatePoError
                                                );

                                                res.status(500).json({
                                                    success: false,
                                                    message: "Failed to generate Purchase Order number."
                                                });

                                            });

                                        }

                                        const insertItemSql = `
                                            INSERT INTO purchase_order_items
                                            (
                                                purchase_order_id,
                                                product_id,
                                                quantity
                                            )
                                            VALUES
                                            (?, ?, ?)
                                        `;


                                        let completedItems = 0;
                                        let itemInsertError = null;


                                        cleanedItems.forEach(
                                            item => {

                                                db.query(
                                                    insertItemSql,
                                                    [
                                                        purchaseOrderId,
                                                        item.product_id,
                                                        item.quantity
                                                    ],
                                                    (itemError) => {

                                                        if (
                                                            itemError &&
                                                            !itemInsertError
                                                        ) {

                                                            itemInsertError =
                                                                itemError;

                                                        }


                                                        completedItems++;


                                                        if (
                                                            completedItems ===
                                                            cleanedItems.length
                                                        ) {

                                                            if (
                                                                itemInsertError
                                                            ) {

                                                                return db.rollback(
                                                                    () => {

                                                                        console.error(
                                                                            "Purchase Order Item Error:",
                                                                            itemInsertError
                                                                        );

                                                                        res.status(500).json({
                                                                            success: false,
                                                                            message: "Failed to save Purchase Order items."
                                                                        });

                                                                    }
                                                                );

                                                            }

                                                            db.commit(
                                                                (
                                                                    commitError
                                                                ) => {

                                                                    if (
                                                                        commitError
                                                                    ) {

                                                                        return db.rollback(
                                                                            () => {

                                                                                console.error(
                                                                                    "Purchase Order Commit Error:",
                                                                                    commitError
                                                                                );

                                                                                res.status(500).json({
                                                                                    success: false,
                                                                                    message: "Failed to complete Purchase Order."
                                                                                });

                                                                            }
                                                                        );

                                                                    }


                                                                    res.status(
                                                                        201
                                                                    ).json({

                                                                        success:
                                                                            true,

                                                                        message:
                                                                            "Purchase Order created successfully!",

                                                                        purchase_order:
                                                                            {

                                                                                id:
                                                                                    purchaseOrderId,

                                                                                po_number:
                                                                                    finalPoNumber,

                                                                                supplier_id:
                                                                                    supplier_id,

                                                                                supplier_name:
                                                                                    supplierResults[0]
                                                                                        .supplier_name,

                                                                                status:
                                                                                    "Pending",

                                                                                items:
                                                                                    cleanedItems.length

                                                                            }

                                                                    });

                                                                }
                                                            );

                                                        }

                                                    }
                                                );

                                            }
                                        );

                                    }
                                );

                            }
                        );

                    }
                );

            }
        );

    });

});

router.get("/all", (req, res) => {

    const sql = `
        SELECT
            po.id,
            po.po_number,
            po.supplier_id,
            s.supplier_code,
            s.supplier_name,
            po.order_date,
            po.status
        FROM purchase_orders po
        INNER JOIN suppliers s
            ON po.supplier_id = s.id
        ORDER BY po.id DESC
    `;


    db.query(sql, (err, results) => {

        if (err) {

            console.error(
                "Purchase Orders List Error:",
                err
            );

            return res.status(500).json({
                success: false,
                message: "Failed to load Purchase Orders."
            });

        }


        res.json(results);

    });

});

router.get("/:id", (req, res) => {

    const purchaseOrderId =
        Number(req.params.id);


    if (
        !Number.isInteger(purchaseOrderId) ||
        purchaseOrderId <= 0
    ) {

        return res.status(400).json({
            success: false,
            message: "Invalid Purchase Order ID."
        });

    }


    const headerSql = `
        SELECT
            po.id,
            po.po_number,
            po.supplier_id,
            s.supplier_code,
            s.supplier_name,
            s.contact_person,
            s.contact_number,
            s.email,
            s.address,
            po.order_date,
            po.status
        FROM purchase_orders po
        INNER JOIN suppliers s
            ON po.supplier_id = s.id
        WHERE po.id = ?
        LIMIT 1
    `;


    db.query(
        headerSql,
        [purchaseOrderId],
        (headerError, headerResults) => {

            if (headerError) {

                console.error(
                    "Purchase Order Details Error:",
                    headerError
                );

                return res.status(500).json({
                    success: false,
                    message: "Failed to load Purchase Order."
                });

            }


            if (headerResults.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "Purchase Order not found."
                });

            }


            const itemsSql = `
                SELECT
                    poi.id,
                    poi.purchase_order_id,
                    poi.product_id,
                    p.product_name,
                    p.category,
                    p.price,
                    poi.quantity
                FROM purchase_order_items poi
                INNER JOIN products p
                    ON poi.product_id = p.id
                WHERE poi.purchase_order_id = ?
                ORDER BY poi.id ASC
            `;


            db.query(
                itemsSql,
                [purchaseOrderId],
                (itemsError, itemResults) => {

                    if (itemsError) {

                        console.error(
                            "Purchase Order Items Error:",
                            itemsError
                        );

                        return res.status(500).json({
                            success: false,
                            message: "Failed to load Purchase Order items."
                        });

                    }


                    res.json({

                        success: true,

                        purchase_order:
                            headerResults[0],

                        items:
                            itemResults

                    });

                }
            );

        }
    );

});


module.exports = router;