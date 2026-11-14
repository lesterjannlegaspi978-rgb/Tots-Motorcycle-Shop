const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const router = express.Router();
const db = require("./db");

const MAX_ATTEMPTS = 3;
const LOCK_MINUTES = 2;
const loginAttempts = new Map();

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

function getAttemptInfo(key) {
    const info = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };

    if (info.lockedUntil && info.lockedUntil <= Date.now()) {
        info.count = 0;
        info.lockedUntil = 0;
    }

    return info;

}

function lockedResponse(res, info) {
    const seconds = Math.max(
        1,
        Math.ceil((info.lockedUntil - Date.now()) / 1000)
    );

    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;

    const timeText =
        minutes > 0
            ? `${minutes}:${String(remainder).padStart(2, "0")}`
            : `${seconds} second(s)`;

       return res.status(429).json({
        success: false,
        locked: true,
        retryAfter: seconds,
        message: `Too many failed attempts. Try again in ${timeText}.`
    });
}

function registerFailedAttempt(key, res) {
    const info = getAttemptInfo(key);
    info.count += 1;

    if (info.count >= MAX_ATTEMPTS) {
        info.lockedUntil = Date.now() + LOCK_MINUTES * 60 * 1000;
        loginAttempts.set(key, info);

        return lockedResponse(res, info);

    }

    loginAttempts.set(key, info);

    const attemptsLeft = MAX_ATTEMPTS - info.count;

    return res.status(401).json({
        success: false,
        attemptsLeft: attemptsLeft,
        message: `Invalid username or password. ${attemptsLeft} attempt(s) left.`
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

        const user = results[0];

        const attemptKey = user

            ? `user:${user.id}`
            : `name:${username.trim().toLowerCase()}`;

        const info = getAttemptInfo(attemptKey);

        if (info.lockedUntil > Date.now()) {
            return lockedResponse(res, info);
        }

        if (!user) {
            return registerFailedAttempt(attemptKey, res);
        }

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return registerFailedAttempt(attemptKey, res);
        }

        loginAttempts.delete(attemptKey);

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
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