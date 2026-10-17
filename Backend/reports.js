const express = require("express");
const router = express.Router();
const db = require("./db");

router.get("/summary", (req, res) => {

    const sql = `
    SELECT
        (SELECT COUNT(*) FROM products) AS totalProducts,
        (SELECT COUNT(*) FROM products WHERE quantity >= 1 AND quantity <= 10) AS lowStocks,
        (SELECT IFNULL(SUM(total),0) FROM sales) AS grossSales,
        (
            SELECT IFNULL(SUM(refund_amount),0)
            FROM sales_returns
            WHERE status = 'Refunded'
        ) AS totalRefunds
    `;

    db.query(sql, (err, result) => {

        if(err){
            console.log(err);
            return res.send({});
        }

        const row = result[0];

        const grossSales = Number(row.grossSales) || 0;
        const totalRefunds = Number(row.totalRefunds) || 0;

        const netSales = Math.max(grossSales - totalRefunds, 0);

        res.send({
            totalProducts: row.totalProducts,
            lowStocks: row.lowStocks,

            totalSales: netSales.toFixed(2),
            
            grossSales: grossSales.toFixed(2),
            totalRefunds: totalRefunds.toFixed(2)
        });

    });

});

module.exports = router;