const express = require("express");
const router = express.Router();
const db = require("./db");

const LOW_STOCK_LIMIT = 10;

const PERIODS = {
    "7": { days: 7, label: "Last 7 Days" },
    "30": { days: 30, label: "Last 30 Days" },
    "90": { days: 90, label: "Last 90 Days" },
    all: { days: null, label: "All Recorded Sales" }
};

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

function toSqlDate(date) {
    const pad = n => String(n).padStart(2, "0");

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function num(value) {
    return Number(value) || 0;
}


function round(value, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round(num(value) * factor) / factor;
}

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
        if (err) {
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

router.get("/inventory", async (req, res) => {
    const key = String(req.query.period || "");

    if (!Object.prototype.hasOwnProperty.call(PERIODS, key)) {
        return res.status(400).json({
            success: false,
            message: "Please select a valid report period."
        });
    }

    const period = PERIODS[key];

    try {
        const startDate = period.days === null
            ? "1000-01-01 00:00:00"
            : toSqlDate(new Date(Date.now() - period.days * 86400000));

        const products = await runQuery(`
            SELECT id, product_name, category, quantity, price
            FROM products
            ORDER BY id ASC
        `);

        if (products.length === 0) {
            return res.status(404).json({

                success: false,
                message: "No inventory data available. Please add products first."
            });
        }

        const soldRows = await runQuery(`
            SELECT
                product_id,
                COALESCE(SUM(quantity), 0) AS sold_quantity
            FROM sales
            WHERE sale_date >= ?
            GROUP BY product_id
        `, [startDate]);

        const returnRows = await runQuery(`
            SELECT
                product_id,
                COALESCE(SUM(quantity_returned), 0) AS returned_quantity
            FROM sales_returns
            WHERE status IN ('Completed', 'Refunded')
              AND return_date >= ?
            GROUP BY product_id
        `, [startDate]);

        const soldMap = new Map();
        const returnMap = new Map();

        soldRows.forEach(row => {
            soldMap.set(Number(row.product_id), num(row.sold_quantity));
        });

        returnRows.forEach(row => {

            returnMap.set(Number(row.product_id), num(row.returned_quantity));
        });

        let totalStock = 0;
        let stockValue = 0;
        let lowStock = 0;
        let outOfStock = 0;
        let netSold = 0;

        const items = products.map(product => {
            const id = Number(product.id);
            const stock = num(product.quantity);
            const price = num(product.price);

            const sold = Math.max(
                (soldMap.get(id) || 0) - (returnMap.get(id) || 0),
                0
            );

            let status = "In Stock";

            if (stock <= 0) {
                status = "Out of Stock";
                outOfStock += 1;
            } else if (stock <= LOW_STOCK_LIMIT) {
                status = "Low Stock";
                lowStock += 1;
            }

            totalStock += stock;
            stockValue += stock * price;
            netSold += sold;


            return {
                id,
                product_name: product.product_name,
                category: product.category || "Uncategorized",
                stock,
                price: round(price, 2),
                sold,
                status
            };
        });

        return res.json({
            success: true,
            period: { key, label: period.label },
            generatedAt: new Date().toISOString(),
            summary: {
                totalProducts: items.length,
                totalStock,
                stockValue: round(stockValue, 2),
                lowStock,
                outOfStock,
                netSold
            },
            items
        });
    } catch (error) {
        console.error("Inventory Report Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to generate the inventory report."

        });
    }
});

async function askGemini(prompt) {
    if (!process.env.GEMINI_API_KEY) return null;

    const models = ["gemini-flash-lite-latest", "gemini-flash-latest"];

    for (const model of models) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        try {
            const response = await fetch(
                "https://generativelanguage.googleapis.com/v1beta/models/" +
                model + ":generateContent",
                {
                    method: "POST",
                    signal: controller.signal,
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": process.env.GEMINI_API_KEY
                    },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            maxOutputTokens: 400,
                            temperature: 0.2
                        }
                    })
                }

            );

            if (response.ok) {
                const data = await response.json();
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

                if (text && text.trim()) return text.trim();
            }
        } catch (error) {
            console.log("Reports AI error:", error.message);
        } finally {
            clearTimeout(timeout);
        }
    }

    return null;
}

router.post("/insight", async (req, res) => {
    const body = req.body || {};

    const facts = {
        report_period: String(body.periodLabel || "").slice(0, 40),
        total_products: num(body.totalProducts),
        total_stock_pcs: num(body.totalStock),
        stock_value: round(body.stockValue, 2),
        low_stock_products: num(body.lowStock),
        out_of_stock_products: num(body.outOfStock),
        net_quantity_sold_in_period: num(body.netSold),
        products_needing_attention: Array.isArray(body.needAttention)
            ? body.needAttention.slice(0, 5).map(name => String(name).slice(0, 60))
            : [],

        top_sold: Array.isArray(body.topSold)
            ? body.topSold.slice(0, 3).map(item => ({
                name: String(item.name || "").slice(0, 60),
                qty: num(item.qty)
            }))
            : []
    };

    const attention = facts.products_needing_attention.join(", ");

    const fallback =
        "You have " + facts.total_products + " products with " +
        facts.total_stock_pcs.toLocaleString("en-PH") + " pieces in stock worth ₱" +
        facts.stock_value.toLocaleString("en-PH", { minimumFractionDigits: 2 }) +
        ". " + facts.low_stock_products + " product(s) are low on stock and " +
        facts.out_of_stock_products + " are out of stock" +
        (attention ? ", including " + attention + "." : ".");

    const prompt =
        "You are advising the owner of a motorcycle parts shop. " +
        "Write 2 short sentences in simple English that explain this inventory report " +
        "and suggest one practical action. Use 'you' and 'your'. " +
        "Use ONLY the numbers given and do not invent numbers.\n\n" +
        JSON.stringify(facts);

    const text = await askGemini(prompt);

    return res.json({
        success: true,
        aiUsed: Boolean(text),
        insight: text || fallback
    });

});

module.exports = router;