
const express = require("express");
const router = express.Router();
const db = require("./db");

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

async function getFastMovingProducts() {
    const rows = await runQuery(`
        SELECT
            p.id AS product_id,
            p.product_name,
            COALESCE(s.sold_quantity, 0) AS sold_quantity,
            COALESCE(s.transactions, 0) AS transactions,
            COALESCE(r.returned_quantity, 0) AS returned_quantity
        FROM products p

        LEFT JOIN (
            SELECT
                product_id,
                SUM(quantity) AS sold_quantity,
                COUNT(*) AS transactions
            FROM sales
            GROUP BY product_id
        ) s ON s.product_id = p.id

        LEFT JOIN (
            SELECT
                product_id,
                SUM(quantity_returned) AS returned_quantity
            FROM sales_returns
            WHERE status IN ('Completed', 'Refunded')
            GROUP BY product_id
        ) r ON r.product_id = p.id
    `);

    return rows
        .map(row => {
            const sold = Number(row.sold_quantity) || 0;
            const returned = Number(row.returned_quantity) || 0;

            return {
                product_id: Number(row.product_id),
                product_name: row.product_name,
                quantity_sold: Math.max(sold - returned, 0),
                transactions: Number(row.transactions) || 0
            };
        })
        .filter(product => product.quantity_sold > 0)
        .sort((a, b) =>
            b.quantity_sold - a.quantity_sold ||
            a.product_name.localeCompare(b.product_name)
        );
}

router.get("/stats", async (req, res) => {
    try {

        const [
            productRows,
            lowStockRows,
            outOfStockRows,
            salesRows,
            refundRows,
            fastMovingProducts
        ] = await Promise.all([
            runQuery(`
                SELECT COUNT(*) AS total
                FROM products
            `),

            runQuery(`
                SELECT COUNT(*) AS total
                FROM products
                WHERE quantity >= 1 AND quantity <= 10
            `),

            runQuery(`
                SELECT COUNT(*) AS total
                FROM products
                WHERE quantity <= 0
            `),

            runQuery(`
                SELECT COALESCE(SUM(total), 0) AS grossSales
                FROM sales
            `),

            runQuery(`
                SELECT COALESCE(SUM(refund_amount), 0) AS totalRefunds
                FROM sales_returns
                WHERE status = 'Refunded'
            `),

            getFastMovingProducts()
        ]);

        const grossSales =
            Number(salesRows[0].grossSales) || 0;

        const totalRefunds =
            Number(refundRows[0].totalRefunds) || 0;

        const netSales = grossSales - totalRefunds;

        return res.json({
            success: true,

            totalProducts:
                Number(productRows[0].total) || 0,

            lowStocks:
                Number(lowStockRows[0].total) || 0,

            outOfStock:
                Number(outOfStockRows[0].total) || 0,

            grossSales: grossSales.toFixed(2),

            totalSales: netSales.toFixed(2),

            totalRefunds: totalRefunds.toFixed(2),
            netSales: netSales.toFixed(2),

            fastMoving: fastMovingProducts.length
        });

    } catch (error) {
        console.error("DASHBOARD STATS ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to load dashboard statistics."
        });
    }
});

router.get("/fast-moving", async (req, res) => {
    try {
        const products = await getFastMovingProducts();

        return res.json(
            products.map((product, index) => ({
                rank: index + 1,
                product_id: product.product_id,
                product_name: product.product_name,
                quantity_sold: product.quantity_sold,
                transactions: product.transactions
            }))
        );

    } catch (error) {
        console.error("FAST-MOVING PRODUCTS ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to load fast-moving products."
        });
    }
});

router.get("/recent-sales", async (req, res) => {
    try {
        const result = await runQuery(`
            SELECT
                p.product_name,
                s.quantity,
                s.total,
                DATE_FORMAT(
                    s.sale_date,
                    '%b %d, %Y %h:%i %p'
                ) AS sale_date
            FROM sales s
            INNER JOIN products p ON p.id = s.product_id
            ORDER BY s.sale_date DESC
            LIMIT 5
        `);

        return res.json(result);

    } catch (error) {
        console.error("RECENT SALES ERROR:", error);

        return res.status(500).json([]);
    }
});

router.get("/alerts", async (req, res) => {
    try {
        const result = await runQuery(`
            SELECT product_name, quantity
            FROM products
            WHERE quantity >= 1 AND quantity <= 10
            ORDER BY quantity ASC, product_name ASC
        `);

        return res.json(result);

    } catch (error) {
        console.error("LOW STOCK ALERT ERROR:", error);

        return res.status(500).json([]);
    }
});

module.exports = router;
