const express = require("express");
const router = express.Router();
const db = require("./db");


const ALLOWED_METHODS = [
    "Cash"
];

router.get("/returns", (req, res) => {

    const sql = `
        SELECT
            sr.id AS return_id,
            sr.sale_id,
            sr.product_id,
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
        WHERE sr.status = 'Completed'
        ORDER BY sr.return_date DESC
    `;


    db.query(sql, (err, result) => {

        if (err) {

            console.log(
                "Refund - Get Returns Error:",
                err
            );

            return res.send({
                success: false,
                message: "Failed to load sales returns.",
                data: []
            });
        }


        res.send({
            success: true,
            data: result

        });

    });

});

router.get("/returns/:id", (req, res) => {

    const returnId = req.params.id;


    const sql = `
        SELECT
            sr.id AS return_id,
            sr.sale_id,
            sr.product_id,
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
        WHERE sr.id = ?
    `;


    db.query(
        sql,
        [returnId],
        (err, result) => {

            if (err) {

                console.log(
                    "Refund - Get Return Error:",
                    err
                );

                return res.send({
                    success: false,
                    message: "Failed to load sales return."
                });
            }


            if (result.length === 0) {

                return res.send({
                    success: false,
                    message: "Sales return not found."
                });
            }



            res.send({
                success: true,
                data: result[0]
            });

        }
    );

});

router.post("/process", (req, res) => {

    const {
        return_id,
        refund_note
    } = req.body;

    const refund_method = req.body.refund_method || "Cash";

    if (!return_id) {

        return res.send({
            success: false,
            message: "Sales return is required."
        });
    }


    if (!ALLOWED_METHODS.includes(refund_method)) {

        return res.send({
            success: false,
            message: "Invalid refund method. Only Cash is accepted."
        });
    }

    const checkSql = `
        SELECT
            sr.id,
            sr.sale_id,
            sr.product_id,
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
        WHERE sr.id = ?
    `;


    db.query(
        checkSql,
        [return_id],
        (err, result) => {

            if (err) {

                console.log(
                    "Refund - Check Return Error:",
                    err
                );

                return res.send({
                    success: false,
                    message: "Failed to verify sales return."
                });
            }


            if (result.length === 0) {


                return res.send({
                    success: false,
                    message: "Sales return not found."
                });
            }

            const salesReturn = result[0];

            if (salesReturn.status === "Refunded") {

                return res.send({
                    success: false,
                    message: "This sales return has already been refunded."
                });
            }


            if (salesReturn.status !== "Completed") {

                return res.send({
                    success: false,
                    message:
                        "This sales return is not available for refund."
                });

            }

            const updateSql = `
                UPDATE sales_returns
                SET
                    status = 'Refunded'
                WHERE id = ?
                AND status = 'Completed'
            `;


            db.query(
                updateSql,
                [return_id],
                (err2, updateResult) => {

                    if (err2) {

                        console.log(
                            "Refund - Update Error:",
                            err2
                        );

                        return res.send({
                            success: false,
                            message: "Failed to process refund."
                        });


                    }


                    if (updateResult.affectedRows === 0) {

                        return res.send({
                            success: false,
                            message:
                                "Refund could not be processed. The return may already be refunded."
                        });
                    }

                    const insertSql = `
                        INSERT INTO refunds
                            (return_id, refund_amount, refund_method, status, refund_date)
                        VALUES
                            (?, ?, ?, 'Refunded', NOW())
                    `;


                    db.query(
                        insertSql,
                        [
                            salesReturn.id,
                            salesReturn.refund_amount,
                            refund_method
                        ],


                        (err3) => {

                            if (err3) {

                                console.log(
                                    "Refund - Insert Error:",
                                    err3
                                );

                                const rollbackSql = `
                                    UPDATE sales_returns
                                    SET status = 'Completed'
                                    WHERE id = ?
                                    AND status = 'Refunded'
                                `;

                                return db.query(
                                    rollbackSql,
                                    [return_id],
                                    () => {

                                        res.send({
                                            success: false,
                                            message:
                                                "Failed to save the refund record. Please try again."
                                        });

                                    }

                                );
                            }

                            res.send({
                                success: true,
                                message: "Refund Processed Successfully.",
                                refund: {
                                    return_id: salesReturn.id,
                                    sale_id: salesReturn.sale_id,
                                    product_name:
                                        salesReturn.product_name,
                                    quantity:
                                        salesReturn.quantity_returned,
                                    refund_amount:
                                        salesReturn.refund_amount,
                                    refund_method:
                                        refund_method,
                                    refund_note:
                                        refund_note || null
                                }
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
            sr.id AS return_id,
            sr.sale_id,
            products.product_name,
            sr.quantity_returned,
            sr.refund_amount,
            sr.reason,
            sr.status,
            COALESCE(r.refund_method, 'Cash') AS refund_method,
            DATE_FORMAT(
                COALESCE(r.refund_date, sr.return_date),
                '%b %d, %Y %h:%i %p'
            ) AS refund_date
        FROM sales_returns sr
        JOIN products
            ON sr.product_id = products.id

        LEFT JOIN (
            SELECT
                return_id,
                MAX(refund_date) AS refund_date,
                MAX(refund_method) AS refund_method
            FROM refunds
            GROUP BY return_id
        ) r
            ON r.return_id = sr.id
        WHERE sr.status = 'Refunded'
        ORDER BY COALESCE(r.refund_date, sr.return_date) DESC
    `;


    db.query(sql, (err, result) => {

        if (err) {

            console.log(
                "Refund - Get All Error:",
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