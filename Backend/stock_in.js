const express = require("express");
const router = express.Router();
const db = require("./db");

function query(sql, params = []) {

    return new Promise((resolve, reject) => {

        db.query(
            sql,
            params,
            (error, results) => {

                if (error) {
                    reject(error);
                    return;
                }

                resolve(results);

            }
        );

    });

}

function beginTransaction() {

    return new Promise((resolve, reject) => {

        db.beginTransaction(error => {

            if (error) {
                reject(error);
                return;
            }

            resolve();

        });

    });

}

function commitTransaction() {

    return new Promise((resolve, reject) => {

        db.commit(error => {

            if (error) {
                reject(error);
                return;
            }

            resolve();

        });

    });

}

function rollbackTransaction() {

    return new Promise(resolve => {

        db.rollback(() => {

            resolve();

        });

    });

}

router.get("/purchase-orders", async (req, res) => {

    try {

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

            WHERE po.status IN ('Pending', 'Partial')

            ORDER BY po.id DESC

        `;


        const results =
            await query(sql);


        res.json(results);


    } catch (error) {

        console.error(
            "Stock-In Purchase Orders Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to load Purchase Orders."

        });

    }

});

router.get(
    "/purchase-orders/:id",
    async (req, res) => {

        const purchaseOrderId =
            Number(req.params.id);


        if (
            !Number.isInteger(purchaseOrderId) ||
            purchaseOrderId <= 0
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid Purchase Order ID."

            });

        }


        try {

            const headerSql = `

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

                WHERE po.id = ?

                LIMIT 1

            `;


            const headerResults =
                await query(
                    headerSql,
                    [purchaseOrderId]
                );


            if (
                headerResults.length === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Purchase Order not found."

                });

            }

            const itemsSql = `

                SELECT

                    poi.id,

                    poi.product_id,

                    p.product_name,

                    p.category,

                    p.price,

                    poi.quantity AS ordered_quantity,

                    COALESCE(

                        (

                            SELECT
                                SUM(sii.quantity_received)

                            FROM stock_in_items sii

                            INNER JOIN stock_ins si

                                ON sii.stock_in_id = si.id

                            WHERE
                                si.purchase_order_id = ?

                                AND sii.product_id =
                                    poi.product_id

                                AND si.status = 'Completed'

                        ),

                        0

                    ) AS received_quantity

                FROM purchase_order_items poi

                INNER JOIN products p

                    ON poi.product_id = p.id

                WHERE
                    poi.purchase_order_id = ?

                ORDER BY poi.id ASC

            `;


            const itemResults =
                await query(
                    itemsSql,
                    [
                        purchaseOrderId,
                        purchaseOrderId
                    ]
                );


            const items =
                itemResults.map(item => {

                    const ordered =
                        Number(
                            item.ordered_quantity
                        ) || 0;


                    const received =
                        Number(
                            item.received_quantity
                        ) || 0;


                    return {

                        ...item,

                        ordered_quantity:
                            ordered,

                        received_quantity:
                            received,

                        remaining_quantity:
                            Math.max(
                                0,
                                ordered - received
                            )

                    };

                });


            res.json({

                success: true,

                purchase_order:
                    headerResults[0],

                items:
                    items

            });


        } catch (error) {

            console.error(
                "Stock-In Purchase Order Details Error:",
                error
            );


            res.status(500).json({

                success: false,

                message:
                    "Failed to load Purchase Order details."

            });

        }

    }
);

router.post("/create", async (req, res) => {

    let {

        purchase_order_id,

        items

    } = req.body;


    purchase_order_id =
        Number(purchase_order_id);

    if (

        !Number.isInteger(
            purchase_order_id
        ) ||

        purchase_order_id <= 0

    ) {

        return res.status(400).json({

            success: false,

            message:
                "Please select a valid Purchase Order."

        });

    }


    if (
        !Array.isArray(items) ||
        items.length === 0
    ) {

        return res.status(400).json({

            success: false,

            message:
                "Please add at least one product."

        });

    }

    const cleanedItems = [];

    const usedProductIds =
        new Set();


    for (const item of items) {

        const productId =
            Number(
                item.product_id
            );


        const quantityReceived =
            Number(
                item.quantity_received
            );


        if (

            !Number.isInteger(
                productId
            ) ||

            productId <= 0

        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid product."

            });

        }


        if (

            !Number.isInteger(
                quantityReceived
            ) ||

            quantityReceived <= 0

        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Received quantity must be a whole number greater than zero."

            });

        }


        if (
            usedProductIds.has(
                productId
            )
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "A product cannot be added more than once."

            });

        }


        usedProductIds.add(
            productId
        );


        cleanedItems.push({

            product_id:
                productId,

            quantity_received:
                quantityReceived

        });

    }


    let transactionStarted =
        false;


    try {

        await beginTransaction();

        transactionStarted = true;

        const poSql = `

            SELECT

                po.id,

                po.po_number,

                po.supplier_id,

                po.status,

                s.supplier_name

            FROM purchase_orders po

            INNER JOIN suppliers s

                ON po.supplier_id = s.id

            WHERE po.id = ?

            FOR UPDATE

        `;


        const poResults =
            await query(
                poSql,
                [purchase_order_id]
            );


        if (
            poResults.length === 0
        ) {

            await rollbackTransaction();

            return res.status(404).json({

                success: false,

                message:
                    "Purchase Order not found."

            });

        }


        const purchaseOrder =
            poResults[0];


        if (
            purchaseOrder.status !==
                "Pending" &&

            purchaseOrder.status !==
                "Partial"

        ) {

            await rollbackTransaction();

            return res.status(400).json({

                success: false,

                message:
                    "This Purchase Order is no longer available for Stock-In."

            });

        }

        const orderedItemsSql = `

            SELECT

                poi.product_id,

                poi.quantity AS ordered_quantity,

                p.product_name,

                p.price

            FROM purchase_order_items poi

            INNER JOIN products p

                ON poi.product_id = p.id

            WHERE
                poi.purchase_order_id = ?

            FOR UPDATE

        `;


        const orderedItems =
            await query(
                orderedItemsSql,
                [purchase_order_id]
            );


        if (
            orderedItems.length === 0
        ) {

            await rollbackTransaction();

            return res.status(400).json({

                success: false,

                message:
                    "This Purchase Order has no products."

            });

        }

        const validatedItems = [];


        for (
            const item
            of cleanedItems
        ) {

            const poItem =
                orderedItems.find(

                    row =>
                        Number(
                            row.product_id
                        ) ===
                        Number(
                            item.product_id
                        )

                );


            if (!poItem) {

                await rollbackTransaction();

                return res.status(400).json({

                    success: false,

                    message:
                        "One or more selected products do not belong to this Purchase Order."

                });

            }

            const receivedSql = `

                SELECT

                    COALESCE(
                        SUM(
                            sii.quantity_received
                        ),
                        0
                    ) AS total_received

                FROM stock_in_items sii

                INNER JOIN stock_ins si

                    ON sii.stock_in_id =
                        si.id

                WHERE

                    si.purchase_order_id = ?

                    AND sii.product_id = ?

                    AND si.status =
                        'Completed'

            `;


            const receivedResults =
                await query(

                    receivedSql,

                    [

                        purchase_order_id,

                        item.product_id

                    ]

                );


            const previousReceived =
                Number(

                    receivedResults[0]
                        .total_received

                ) || 0;


            const orderedQuantity =
                Number(
                    poItem.ordered_quantity
                );


            const remainingQuantity =
                orderedQuantity -
                previousReceived;


            if (
                item.quantity_received >
                remainingQuantity
            ) {

                await rollbackTransaction();

                return res.status(400).json({

                    success: false,

                    message:

                        `Insufficient remaining quantity for ${poItem.product_name}. Ordered: ${orderedQuantity}, Already received: ${previousReceived}, Remaining: ${remainingQuantity}.`

                });

            }


            validatedItems.push({

                product_id:
                    item.product_id,

                quantity_received:
                    item.quantity_received,

                unit_price:
                    Number(
                        poItem.price
                    ) || 0,

                product_name:
                    poItem.product_name

            });

        }

        const temporaryNumber =
            `TEMP-SI-${Date.now()}`;


        const insertStockInSql = `

            INSERT INTO stock_ins

            (

                stock_in_number,

                purchase_order_id,

                supplier_id,

                status

            )

            VALUES

            (

                ?,

                ?,

                ?,

                'Completed'

            )

        `;


        const stockInResult =
            await query(

                insertStockInSql,

                [

                    temporaryNumber,

                    purchase_order_id,

                    purchaseOrder.supplier_id

                ]

            );


        const stockInId =
            stockInResult.insertId;

        const finalStockInNumber =
            `SI-${String(
                stockInId
            ).padStart(4, "0")}`;


        const updateStockInNumberSql = `

            UPDATE stock_ins

            SET stock_in_number = ?

            WHERE id = ?

        `;


        await query(

            updateStockInNumberSql,

            [

                finalStockInNumber,

                stockInId

            ]

        );

        for (
            const item
            of validatedItems
        ) {

            const insertItemSql = `

                INSERT INTO stock_in_items

                (

                    stock_in_id,

                    product_id,

                    quantity_received,

                    unit_price

                )

                VALUES

                (

                    ?,

                    ?,

                    ?,

                    ?

                )

            `;


            await query(

                insertItemSql,

                [

                    stockInId,

                    item.product_id,

                    item.quantity_received,

                    item.unit_price

                ]

            );

            const updateProductSql = `

                UPDATE products

                SET quantity =
                    quantity + ?

                WHERE id = ?

            `;


            await query(

                updateProductSql,

                [

                    item.quantity_received,

                    item.product_id

                ]

            );

        }

        let allItemsFullyReceived =
            true;


        for (
            const poItem
            of orderedItems
        ) {

            const receivedSql = `

                SELECT

                    COALESCE(
                        SUM(
                            sii.quantity_received
                        ),
                        0
                    ) AS total_received

                FROM stock_in_items sii

                INNER JOIN stock_ins si

                    ON sii.stock_in_id =
                        si.id

                WHERE

                    si.purchase_order_id = ?

                    AND sii.product_id = ?

                    AND si.status =
                        'Completed'

            `;


            const receivedResults =
                await query(

                    receivedSql,

                    [

                        purchase_order_id,

                        poItem.product_id

                    ]

                );


            const totalReceived =
                Number(

                    receivedResults[0]
                        .total_received

                ) || 0;


            const orderedQuantity =
                Number(
                    poItem.ordered_quantity
                );


            if (
                totalReceived <
                orderedQuantity
            ) {

                allItemsFullyReceived =
                    false;

                break;

            }

        }


        const newPoStatus =
            allItemsFullyReceived
                ? "Completed"
                : "Partial";

        const updatePoStatusSql = `

            UPDATE purchase_orders

            SET status = ?

            WHERE id = ?

        `;


        await query(

            updatePoStatusSql,

            [

                newPoStatus,

                purchase_order_id

            ]

        );

        await commitTransaction();

        transactionStarted = false;

        res.status(201).json({

            success: true,

            message:
                "Stock-In transaction recorded successfully!",

            stock_in: {

                id:
                    stockInId,

                stock_in_number:
                    finalStockInNumber,

                purchase_order_id:
                    purchase_order_id,

                po_number:
                    purchaseOrder.po_number,

                supplier_id:
                    purchaseOrder.supplier_id,

                supplier_name:
                    purchaseOrder.supplier_name,

                status:
                    "Completed",

                purchase_order_status:
                    newPoStatus,

                items:
                    validatedItems.length

            }

        });


    } catch (error) {

        console.error(
            "Create Stock-In Error:",
            error
        );


        if (transactionStarted) {

            await rollbackTransaction();

        }


        res.status(500).json({

            success: false,

            message:
                "Failed to record Stock-In transaction."

        });

    }

});

router.get("/all", async (req, res) => {

    try {

        const sql = `

            SELECT

                si.id,

                si.stock_in_number,

                si.purchase_order_id,

                po.po_number,

                s.supplier_code,

                s.supplier_name,

                si.stock_in_date,

                si.status

            FROM stock_ins si

            INNER JOIN purchase_orders po

                ON si.purchase_order_id =
                    po.id

            INNER JOIN suppliers s

                ON si.supplier_id =
                    s.id

            ORDER BY
                si.id DESC

        `;


        const results =
            await query(sql);


        res.json(results);


    } catch (error) {

        console.error(
            "Stock-In List Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to load Stock-In transactions."

        });

    }

});

router.get("/:id", async (req, res) => {

    const stockInId =
        Number(req.params.id);


    if (

        !Number.isInteger(
            stockInId
        ) ||

        stockInId <= 0

    ) {

        return res.status(400).json({

            success: false,

            message:
                "Invalid Stock-In ID."

        });

    }


    try {

        const headerSql = `

            SELECT

                si.id,

                si.stock_in_number,

                si.purchase_order_id,

                po.po_number,

                si.supplier_id,

                s.supplier_code,

                s.supplier_name,

                si.stock_in_date,

                si.status

            FROM stock_ins si

            INNER JOIN purchase_orders po

                ON si.purchase_order_id =
                    po.id

            INNER JOIN suppliers s

                ON si.supplier_id =
                    s.id

            WHERE
                si.id = ?

            LIMIT 1

        `;


        const headerResults =
            await query(

                headerSql,

                [stockInId]

            );


        if (
            headerResults.length === 0
        ) {

            return res.status(404).json({

                success: false,

                message:
                    "Stock-In transaction not found."

            });

        }


        const itemsSql = `

            SELECT

                sii.id,

                sii.product_id,

                p.product_name,

                p.category,

                sii.quantity_received,

                sii.unit_price,

                sii.created_at

            FROM stock_in_items sii

            INNER JOIN products p

                ON sii.product_id =
                    p.id

            WHERE
                sii.stock_in_id = ?

            ORDER BY
                sii.id ASC

        `;


        const itemResults =
            await query(

                itemsSql,

                [stockInId]

            );


        res.json({

            success: true,

            stock_in:
                headerResults[0],

            items:
                itemResults

        });


    } catch (error) {

        console.error(
            "Stock-In Details Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to load Stock-In details."

        });

    }

});


module.exports = router;