const express = require('express');
const router = express.Router();
const db = require('./db');

router.get('/stats', (req, res) => {

    db.query('SELECT COUNT(*) as total FROM products', (err, products) => {
        if (err) return res.send({ error: err });

        db.query('SELECT COUNT(*) as total FROM products WHERE quantity <= 10', (err, lowStocks) => {
            if (err) return res.send({ error: err });

            db.query('SELECT SUM(total) as total FROM sales', (err, sales) => {
                if (err) return res.send({ error: err });

                db.query('SELECT COUNT(DISTINCT product_id) as total FROM sales', (err, fastMoving) => {
                    if (err) return res.send({ error: err });

                    res.json({
                        totalProducts: products[0].total,
                        lowStocks: lowStocks[0].total,
                        totalSales: sales[0].total ? parseFloat(sales[0].total).toFixed(2) : '0.00',
                        fastMoving: fastMoving[0].total
                    });
                });
            });
        });
    });
});
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

        if(err){
            console.log(err);
            return res.send([]);
        }

        res.send(result);

    });

});
router.get("/alerts", (req, res) => {

    const sql = `
    SELECT
        product_name,
        quantity
    FROM products
    WHERE quantity <= 10
    ORDER BY quantity ASC
    `;

    db.query(sql, (err, result) => {

        if(err){
            console.log(err);
            return res.send([]);
        }

        res.send(result);

    });

});

module.exports = router;