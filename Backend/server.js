require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const jwt = require("jsonwebtoken");

const auth = require("./auth");
const dashboard = require("./dashboard");
const products = require("./products");
const sales = require("./sales");
const reports = require("./reports");
const suppliers = require("./supplier");
const purchaseOrders = require("./purchase_order");
const stockIn = require("./stock_in");
const salesReturn = require("./sales_return");
const refund = require("./refund");
const ai = require("./ai_recommendation");
const analytics = require("./analytics");

const app = express();

app.use(cors());
app.use(express.json());

function verifyToken(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }


    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET || "tots_motorshop_secret");
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
}

app.use("/auth", auth);
app.use("/dashboard", verifyToken, dashboard);
app.use("/products", verifyToken, products);
app.use("/sales", verifyToken, sales);
app.use("/reports", verifyToken, reports);
app.use("/suppliers", verifyToken, suppliers);
app.use("/purchase-orders", verifyToken, purchaseOrders);
app.use("/stock-in", verifyToken, stockIn);
app.use("/sales-returns", verifyToken, salesReturn);
app.use("/refunds", verifyToken, refund);
app.use("/ai", verifyToken, ai);
app.use("/analytics", verifyToken, analytics);

app.use(express.static(path.join(__dirname, "../Frontend")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../Frontend/index.html"));
});

const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);

});