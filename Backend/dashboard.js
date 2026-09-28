const express = require('express');
const router = express.Router();
const db = require('./db');


/* =========================
   DASHBOARD STATS
========================= */

router.get('/stats', (req, res) => {

    // TOTAL PRODUCTS
    db.query(
        'SELECT COUNT(*) as total FROM products',
        (err, products) => {

            if (err) {
                console.log("TOTAL PRODUCTS ERROR:", err);
                return res.send({
                    error: err
                });
            }


            // LOW STOCK
            // 1 to 10 pieces
            db.query(
                `SELECT COUNT(*) as total
                 FROM products
                 WHERE quantity >= 1
                 AND quantity <= 10`,
                (err, lowStocks) => {

                    if (err) {
                        console.log("LOW STOCK ERROR:", err);
                        return res.send({
                            error: err
                        });
                    }


                    // OUT OF STOCK
                    // exactly 0 pieces
                    db.query(
                        `SELECT COUNT(*) as total
                         FROM products
                         WHERE quantity = 0`,
                        (err, outOfStock) => {

                            if (err) {
                                console.log("OUT OF STOCK ERROR:", err);
                                return res.send({
                                    error: err
                                });
                            }


                            // TOTAL SALES
                            db.query(
                                'SELECT SUM(total) as total FROM sales',
                                (err, sales) => {

                                    if (err) {
                                        console.log("TOTAL SALES ERROR:", err);
                                        return res.send({
                                            error: err
                                        });
                                    }


                                    // FAST MOVING PRODUCTS
                                    db.query(
                                        `SELECT COUNT(DISTINCT product_id) as total
                                         FROM sales`,
                                        (err, fastMoving) => {

                                            if (err) {
                                                console.log(
                                                    "FAST MOVING ERROR:",
                                                    err
                                                );

                                                return res.send({
                                                    error: err
                                                });
                                            }


                                            // SEND ALL DASHBOARD DATA
                                            res.json({

                                                totalProducts:
                                                    products[0].total,

                                                lowStocks:
                                                    lowStocks[0].total,

                                                outOfStock:
                                                    outOfStock[0].total,

                                                totalSales:
                                                    sales[0].total
                                                        ? parseFloat(
                                                            sales[0].total
                                                        ).toFixed(2)
                                                        : '0.00',

                                                fastMoving:
                                                    fastMoving[0].total

                                            });

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


/* =========================
   RECENT SALES
========================= */

router.get('/recent-sales', (req, res) => {

    const sql = `
        SELECT
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
        LIMIT 5
    `;


    db.query(sql, (err, result) => {

        if (err) {

            console.log(
                "RECENT SALES ERROR:",
                err
            );

            return res.send([]);

        }


        res.send(result);

    });

});


/* =========================
   LOW STOCK ALERTS
========================= */

router.get("/alerts", (req, res) => {

    const sql = `
        SELECT
            product_name,
            quantity
        FROM products
        WHERE quantity >= 1
        AND quantity <= 10
        ORDER BY quantity ASC
    `;


    db.query(sql, (err, result) => {

        if (err) {

            console.log(
                "LOW STOCK ALERT ERROR:",
                err
            );

            return res.send([]);

        }


        res.send(result);

    });

});


module.exports = router;