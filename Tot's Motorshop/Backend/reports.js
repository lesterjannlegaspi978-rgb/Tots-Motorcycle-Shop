const express = require("express");
const router = express.Router();
const db = require("./db");

router.get("/summary", (req, res) => {

    const sql = `
    SELECT
        (SELECT COUNT(*) FROM products) AS totalProducts,
        (SELECT COUNT(*) FROM products WHERE quantity <= 10) AS lowStocks,
        (SELECT IFNULL(SUM(total),0) FROM sales) AS totalSales
    `;

    db.query(sql, (err, result) => {

        if(err){
            console.log(err);
            return res.send({});
        }

        res.send(result[0]);

    });

});

module.exports = router;