const express = require("express");
const router = express.Router();
const db = require("./db");

const LOW_STOCK_LIMIT = 10;
const FAST_MIN_RATE = 1;

const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const insightCache = new Map();

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

function num(value) {
    return Number(value) || 0;
}

function round(value, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round(num(value) * factor) / factor;
}

function isDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const date = new Date(value + "T00:00:00Z");

    return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    );
}

function addDays(key, days) {
    const date = new Date(key + "T00:00:00Z");

    date.setUTCDate(date.getUTCDate() + days);

    return date.toISOString().slice(0, 10);
}

function diffDays(from, to) {
    return Math.round(
        (new Date(to + "T00:00:00Z") - new Date(from + "T00:00:00Z")) / 86400000
    );
}

function labelDate(key) {
    const parts = key.split("-");

    return MONTH_NAMES[Number(parts[1]) - 1] + " " + Number(parts[2]) + ", " + parts[0];
}

function validateRange(query) {
    const from = String(query.from || "");
    const to = String(query.to || "");

    if (!isDateKey(from) || !isDateKey(to)) {
        return { error: "Please select a valid date range." };
    }

    if (from > to) {
        return { error: "From Date cannot be later than To Date." };
    }

    if (diffDays(from, to) > 3660) {
        return { error: "The selected date range is too long." };
    }

    return { from, to };
}

async function getSalesData(start, end) {
    const soldRows = await runQuery(`
        SELECT
            product_id,
            COALESCE(SUM(quantity), 0) AS sold_quantity,
            COUNT(DISTINCT DATE(sale_date)) AS sale_days
        FROM sales
        WHERE sale_date >= ?
          AND sale_date < ?
        GROUP BY product_id
    `, [start, end]);

    const returnRows = await runQuery(`
        SELECT
            product_id,
            COALESCE(SUM(quantity_returned), 0) AS returned_quantity
        FROM sales_returns
        WHERE status IN ('Completed', 'Refunded')
          AND return_date >= ?
          AND return_date < ?
        GROUP BY product_id
    `, [start, end]);

    const sold = new Map();
    const returned = new Map();

    soldRows.forEach(row => {
        sold.set(Number(row.product_id), {
            quantity: num(row.sold_quantity),
            days: num(row.sale_days)
        });
    });

    returnRows.forEach(row => {
        returned.set(Number(row.product_id), num(row.returned_quantity));
    });

    return { sold, returned };
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
    const range = validateRange(req.query);

    if (range.error) {
        return res.status(400).json({
            success: false,
            message: range.error
        });
    }

    try {
        const start = range.from + " 00:00:00";
        const end = addDays(range.to, 1) + " 00:00:00";

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

        const { sold, returned } = await getSalesData(start, end);

        let totalStock = 0;
        let stockValue = 0;
        let lowStock = 0;
        let outOfStock = 0;
        let netSold = 0;

        const items = products.map(product => {
            const id = Number(product.id);
            const stock = num(product.quantity);
            const price = num(product.price);
            const soldEntry = sold.get(id);

            const soldQuantity = Math.max(
                (soldEntry ? soldEntry.quantity : 0) - (returned.get(id) || 0),
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
            netSold += soldQuantity;

            return {
                id,
                product_name: product.product_name,
                category: product.category || "Uncategorized",
                stock,
                price: round(price, 2),
                sold: soldQuantity,
                status
            };
        });

        return res.json({
            success: true,
            period: {
                from: range.from,
                to: range.to,
                label: labelDate(range.from) + " to " + labelDate(range.to)
            },
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

router.get("/movement", async (req, res) => {
    const range = validateRange(req.query);

    if (range.error) {
        return res.status(400).json({
            success: false,
            message: range.error
        });
    }

    try {
        const todayRows = await runQuery(
            "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today"
        );

        const today = todayRows[0].today;

        if (range.from > today) {
            return res.status(400).json({
                success: false,
                message: "The selected period has not started yet."
            });
        }

        const effectiveTo = range.to < today ? range.to : today;
        const totalDays = diffDays(range.from, effectiveTo) + 1;

        const start = range.from + " 00:00:00";
        const end = addDays(effectiveTo, 1) + " 00:00:00";

        const products = await runQuery(`
            SELECT id, product_name, category, quantity
            FROM products
            ORDER BY id ASC
        `);

        if (products.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No products available."
            });
        }

        const { sold, returned } = await getSalesData(start, end);

        let fast = 0;
        let slow = 0;
        let noSales = 0;

        const items = products.map(product => {
            const id = Number(product.id);
            const entry = sold.get(id) || { quantity: 0, days: 0 };

            const quantitySold = Math.max(
                entry.quantity - (returned.get(id) || 0),
                0
            );

            const saleDays = Math.min(entry.days, totalDays);

            let status = "No Sales";

            if (saleDays > 0) {
                status = saleDays / totalDays >= FAST_MIN_RATE
                    ? "Fast Moving"
                    : "Slow Moving";
            }

            if (status === "Fast Moving") fast += 1;
            else if (status === "Slow Moving") slow += 1;
            else noSales += 1;

            return {
                id,
                product_name: product.product_name,
                category: product.category || "Uncategorized",
                stock: num(product.quantity),
                sale_days: saleDays,
                quantity_sold: quantitySold,
                status
            };
        });

        const rank = { "Fast Moving": 0, "Slow Moving": 1, "No Sales": 2 };

        items.sort((a, b) => {
            if (rank[a.status] !== rank[b.status]) {
                return rank[a.status] - rank[b.status];
            }

            if (b.sale_days !== a.sale_days) {
                return b.sale_days - a.sale_days;
            }

            if (b.quantity_sold !== a.quantity_sold) {
                return b.quantity_sold - a.quantity_sold;
            }

            return a.id - b.id;
        });

        const cappedNote = effectiveTo < range.to ? " (up to today)" : "";

        return res.json({
            success: true,
            period: {
                from: range.from,
                to: effectiveTo,
                totalDays,
                label: labelDate(range.from) + " to " + labelDate(effectiveTo) + cappedNote
            },
            summary: {
                fast,
                slow,
                noSales,
                totalProducts: items.length
            },
            items
        });
    } catch (error) {
        console.error("Movement Report Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to generate the fast and slow moving report."
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

function cleanInsight(text) {
    if (!text) return null;

    const cleaned = String(text)
        .replace(/\$/g, "₱")
        .replace(/\s+/g, " ")
        .trim();

    if (/online|website|e-commerce|ecommerce|listing/i.test(cleaned)) {
        return null;
    }

    return cleaned;
}

router.post("/insight", async (req, res) => {
    const body = req.body || {};

    const facts = {
        report_period: String(body.periodLabel || "").slice(0, 60),
        total_products: num(body.totalProducts),
        total_stock_pcs: num(body.totalStock),
        stock_value_in_philippine_pesos: round(body.stockValue, 2),
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
        facts.stock_value_in_philippine_pesos.toLocaleString("en-PH", { minimumFractionDigits: 2 }) +
        ". " + facts.low_stock_products + " product(s) are low on stock and " +
        facts.out_of_stock_products + " are out of stock" +
        (attention ? ", including " + attention + "." : ".");

    const prompt =
        "You are advising the owner of a physical motorcycle parts shop in the Philippines. " +
        "Write 2 short sentences in simple English that explain this inventory report " +
        "and suggest one practical action. Use 'you' and 'your'. " +
        "All money amounts are in Philippine pesos. Write them with the ₱ sign and never use the $ sign. " +
        "This is a physical shop, so do not mention online listings, websites, or online sales. " +
        "Do not say anything about dead stock, slow-moving items, fast-moving items, or sales trends. " +
        "Only describe the stock counts, the stock value, the low and out-of-stock items, and the quantity sold exactly as given. " +
        "Use ONLY the numbers given and do not invent numbers.\n\n" +
        JSON.stringify(facts);

    const cacheKey = JSON.stringify(facts);

    if (insightCache.has(cacheKey)) {
        return res.json({
            success: true,
            aiUsed: true,
            insight: insightCache.get(cacheKey)
        });
    }

    let text = null;

    for (let attempt = 0; attempt < 2 && !text; attempt++) {
        text = cleanInsight(await askGemini(prompt));
    }

    if (text) {
        insightCache.set(cacheKey, text);
    }

    return res.json({
        success: true,
        aiUsed: Boolean(text),
        insight: text || fallback
    });
});

module.exports = router;