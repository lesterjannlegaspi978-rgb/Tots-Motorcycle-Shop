const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const router = express.Router();
const db = require("./db");

function runQuery(sql, params) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

router.post("/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: "Please provide username and password"
        });
    }

    try {
        const results = await runQuery(
            "SELECT * FROM admins WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) LIMIT 1",
            [username.trim(), username.trim()]
        );

        if (results.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password"
            });
        }

        const user = results[0];

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password"
            });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET || "tots_motorshop_secret",
            { expiresIn: "1d" }
        );

        return res.json({
            success: true,
            token: token,
            user: {
                id: user.id,
                username: user.username,
                fullname: user.fullname
            }
        });
    } catch (error) {
        console.error("LOGIN DB ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
});

module.exports = router;