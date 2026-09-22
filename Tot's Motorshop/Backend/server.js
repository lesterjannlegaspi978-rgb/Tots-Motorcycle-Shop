require("dotenv").config();

const express = require('express');

const sales = require("./sales");
const products = require('./products');
const cors = require('cors');
const db = require('./db');
const auth = require('./auth');
const dashboard = require('./dashboard');
const reports = require("./reports");

console.log("auth =", auth);
console.log("dashboard =", dashboard);
console.log("products =", products);
console.log("sales =", sales);

const app = express();

app.use(cors());
app.use(express.json());

app.use("/auth", auth);
app.use("/dashboard", dashboard);
app.use("/products", products);
app.use("/sales", sales);
app.use("/reports", reports);

app.listen(5000, () => {
    console.log("Server running on port 5000");
});