const express = require("express");
const router = express.Router();
const db = require("./db");

const RETURNED_JOIN = `
    LEFT JOIN (
        SELECT
            sale_id,
            CAST(SUM(quantity_returned) AS SIGNED) AS returned_quantity
        FROM sales_returns
        WHERE status IN ('Completed', 'Refunded')
        GROUP BY sale_id
    ) returned
        ON returned.sale_id = sales.id
`;

const SALE_COLUMNS = `
    sales.id AS sale_id,
    sales.product_id,
    products.product_name,
    sales.quantity AS sold_quantity,
    sales.total,
    COALESCE(returned.returned_quantity, 0) AS returned_quantity,
    (
        sales.quantity -

        COALESCE(returned.returned_quantity, 0)
    ) AS remaining_quantity,
    DATE_FORMAT(
        sales.sale_date,
        '%b %d, %Y %h:%i %p'
    ) AS sale_date
`;

router.get("/sales", (req, res) => {

    const sql = `
        SELECT
            ${SALE_COLUMNS}
        FROM sales
        JOIN products
            ON sales.product_id = products.id
        ${RETURNED_JOIN}
        WHERE
            (
                sales.quantity -
                COALESCE(returned.returned_quantity, 0)
            ) > 0
        ORDER BY sales.sale_date DESC
    `;

    db.query(sql, (err, result) => {


        if (err) {
            console.log("Sales Return - Get Sales Error:", err);

            return res.send({
                success: false,
                message: "Failed to load sales.",
                data: []
            });
        }

        res.send({
            success: true,
            data: result
        });
    });
});

router.get("/sales/:id", (req, res) => {

    const saleId = req.params.id;

    const sql = `
        SELECT
            ${SALE_COLUMNS}
        FROM sales
        JOIN products
            ON sales.product_id = products.id
        ${RETURNED_JOIN}

        WHERE sales.id = ?
    `;

    db.query(sql, [saleId], (err, result) => {

        if (err) {
            console.log("Sales Return - Get Sale Error:", err);

            return res.send({
                success: false,
                message: "Failed to load sale."
            });
        }

        if (result.length === 0) {
            return res.send({
                success: false,
                message: "Sale not found."
            });
        }

        res.send({
            success: true,
            data: result[0]
        });
    });
});

router.post("/create", (req, res) => {

    const {
        sale_id,
        quantity_returned,
        reason
    } = req.body;

    if (!sale_id || !quantity_returned) {

        return res.send({
            success: false,
            message: "Sale and return quantity are required."
        });
    }


    const returnQuantity = Number(quantity_returned);


    if (!Number.isInteger(returnQuantity) || returnQuantity <= 0) {

        return res.send({
            success: false,
            message: "Return quantity must be a whole number greater than 0."
        });
    }

    const saleSql = `
        SELECT
            sales.id,
            sales.product_id,
            sales.quantity,
            sales.total,
            products.product_name,
            products.quantity AS current_stock
        FROM sales
        JOIN products
            ON sales.product_id = products.id
        WHERE sales.id = ?
    `;

    db.query(saleSql, [sale_id], (err, saleResult) => {

        if (err) {

            console.log("Sales Return - Sale Lookup Error:", err);

            return res.send({
                success: false,
                message: "Failed to find sale."
            });
        }



        if (saleResult.length === 0) {

            return res.send({
                success: false,
                message: "Sale not found."
            });
        }


        const sale = saleResult[0];

        const returnedSql = `
            SELECT
                COALESCE(SUM(quantity_returned), 0) AS returned_quantity
            FROM sales_returns
            WHERE sale_id = ?
            AND status IN ('Completed', 'Refunded')
        `;

        db.query(returnedSql, [sale_id], (err2, returnedResult) => {

            if (err2) {

                console.log(
                    "Sales Return - Previous Return Error:",

                    err2
                );

                return res.send({
                    success: false,
                    message: "Failed to check previous returns."
                });
            }


            const alreadyReturned =
                Number(returnedResult[0].returned_quantity || 0);


            const remainingQuantity =
                Number(sale.quantity) - alreadyReturned;

            if (remainingQuantity <= 0) {

                return res.send({
                    success: false,
                    message:
                        "This sale has already been fully returned."
                });
            }



            if (returnQuantity > remainingQuantity) {

                return res.send({
                    success: false,
                    message:
                        `Cannot return ${returnQuantity} item(s). Only ${remainingQuantity} item(s) can still be returned.`
                });
            }

            const unitPrice =
                Number(sale.total) / Number(sale.quantity);

            const refundAmount =
                unitPrice * returnQuantity;

            const insertSql = `
                INSERT INTO sales_returns
                (
                    sale_id,
                    product_id,
                    quantity_returned,
                    refund_amount,

                    reason,
                    status
                )
                VALUES (?, ?, ?, ?, ?, 'Completed')
            `;

            db.query(
                insertSql,
                [
                    sale.id,
                    sale.product_id,
                    returnQuantity,
                    refundAmount,
                    reason || null
                ],
                (err3, insertResult) => {

                    if (err3) {

                        console.log(
                            "Sales Return - Insert Error:",
                            err3
                        );

                        return res.send({
                            success: false,
                            message: "Failed to save sales return."
                        });
                    }

                    const updateStockSql = `
                        UPDATE products
                        SET quantity = quantity + ?
                        WHERE id = ?
                    `;

                    db.query(
                        updateStockSql,
                        [
                            returnQuantity,
                            sale.product_id
                        ],
                        (err4) => {

                            if (err4) {

                                console.log(
                                    "Sales Return - Inventory Update Error:",
                                    err4
                                );

                                return res.send({
                                    success: false,
                                    message:
                                        "Return was recorded, but inventory update failed. Please check the inventory."
                                });
                            }

                            res.send({
                                success: true,
                                message: "Sales Return Completed.",
                                return_id: insertResult.insertId,
                                product_name: sale.product_name,
                                quantity_returned: returnQuantity,
                                refund_amount: refundAmount
                            });
                        }
                    );
                }
            );
        });
    });
});

router.get("/all", (req, res) => {

    const showHistory = req.query.history === "true";


    const sql = `
        SELECT
            sr.id,
            sr.sale_id,
            products.product_name,
            sr.quantity_returned,
            sr.refund_amount,
            sr.reason,
            sr.status,
            DATE_FORMAT(
                sr.return_date,
                '%b %d, %Y %h:%i %p'
            ) AS return_date
        FROM sales_returns sr
        JOIN products
            ON sr.product_id = products.id
        ${showHistory ? "" : "WHERE sr.status <> 'Refunded'"}
        ORDER BY sr.return_date DESC
    `;

    db.query(sql, (err, result) => {

        if (err) {

            console.log(
                "Sales Return - Get All Error:",
                err
            );

            return res.send({
                success: false,

                data: []
            });
        }

        res.send({
            success: true,
            data: result
        });
    });
});


module.exports = router;