
const express = require("express");
const router = express.Router();
const db = require("./db");

function isValidSupplierCode(value) {
    return /^SUP\d{3}$/.test(value);
}

function isValidSupplierName(value) {
    return /^[A-Za-z0-9&.,'()\- ]{2,150}$/.test(value);
}

function isValidPhilippineMobile(value) {
    return /^09\d{9}$/.test(value);
}

function isValidGmail(value) {
    const gmailPattern = /^[a-z0-9][a-z0-9._%+-]*@gmail\.com$/i;

    if (!gmailPattern.test(value)) {
        return false;
    }

    const localPart = value.split("@")[0];

    if (
        localPart.startsWith(".") ||
        localPart.endsWith(".") ||
        localPart.includes("..")
    ) {
        return false;
    }

    return true;
}

function isValidAddress(value) {
    return value.length >= 5 && value.length <= 255;
}

function cleanAndValidate(body) {
    const data = {
        supplier_code: String(body.supplier_code || "").trim().toUpperCase(),
        supplier_name: String(body.supplier_name || "").trim(),
        contact_number: String(body.contact_number || "").trim(),
        email: String(body.email || "").trim().toLowerCase(),
        address: String(body.address || "").trim()
    };

    if (
        !data.supplier_code ||
        !data.supplier_name ||
        !data.contact_number ||
        !data.email ||
        !data.address
    ) {
        return { error: "Please complete all required supplier fields." };
    }

    if (!isValidSupplierCode(data.supplier_code)) {
        return { error: "Supplier Code must follow the format SUP001." };
    }

    if (!isValidSupplierName(data.supplier_name)) {
        return { error: "Supplier Name contains invalid characters." };
    }

    if (!isValidPhilippineMobile(data.contact_number)) {
        return {
            error: "Contact Number must contain exactly 11 digits and start with 09."
        };
    }

    if (!isValidGmail(data.email)) {
        return {
            error: "Please enter a valid Gmail address ending in @gmail.com."
        };
    }

    if (!isValidAddress(data.address)) {
        return { error: "Please enter a valid supplier address." };
    }

    return { data };
}

function checkDuplicateSupplier(data, excludeId, callback) {
    let sql = `
        SELECT id, supplier_code, contact_number, email
        FROM suppliers
        WHERE (
            supplier_code = ?
            OR LOWER(email) = LOWER(?)
            OR contact_number = ?
        )
    `;

    const params = [
        data.supplier_code,
        data.email,
        data.contact_number
    ];

    if (excludeId !== null) {
        sql += " AND id <> ?";
        params.push(excludeId);
    }

    sql += " LIMIT 1";

    db.query(sql, params, (err, result) => {
        if (err) {
            return callback(err);
        }

        if (result.length > 0) {
            const existing = result[0];

            if (existing.supplier_code === data.supplier_code) {
                return callback(null, {
                    error: "This Supplier Code is already registered."
                });
            }

            if (String(existing.email).toLowerCase() === data.email) {
                return callback(null, {
                    error: "This Gmail address is already registered to another supplier."
                });
            }

            if (existing.contact_number === data.contact_number) {
                return callback(null, {
                    error: "This contact number is already registered to another supplier."
                });
            }
        }

        return callback(null, null);
    });
}

router.post("/add", (req, res) => {
    const checked = cleanAndValidate(req.body);

    if (checked.error) {
        return res.status(400).json({
            success: false,
            message: checked.error
        });
    }

    const data = checked.data;

    checkDuplicateSupplier(data, null, (err, duplicate) => {
        if (err) {
            console.log("CHECK DUPLICATE SUPPLIER ERROR:", err);

            return res.status(500).json({
                success: false,
                message: "Database Error"
            });
        }

        if (duplicate) {
            return res.status(409).json({
                success: false,
                message: duplicate.error
            });
        }

        const sql = `
            INSERT INTO suppliers (
                supplier_code,
                supplier_name,
                contact_number,
                email,
                address
            )
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(
            sql,
            [
                data.supplier_code,
                data.supplier_name,
                data.contact_number,
                data.email,
                data.address
            ],
            (err, result) => {
                if (err) {
                    console.log("ADD SUPPLIER ERROR:", err);

                    if (err.code === "ER_DUP_ENTRY") {
                        return res.status(409).json({
                            success: false,
                            message: "Supplier Code or supplier information already exists."
                        });
                    }

                    return res.status(500).json({
                        success: false,
                        message: "Failed to add supplier."
                    });
                }

                console.log("Supplier added successfully. ID:", result.insertId);

                return res.status(201).json({
                    success: true,
                    message: "Supplier Added Successfully!",
                    supplierId: result.insertId
                });
            }
        );
    });
});

router.get("/all", (req, res) => {
    const sql = `
        SELECT
            id,
            supplier_code,
            supplier_name,
            contact_number,
            email,
            address,
            created_at
        FROM suppliers
        ORDER BY id ASC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log("LOAD SUPPLIERS ERROR:", err);

            return res.status(500).json({
                success: false,
                message: "Database Error"
            });
        }

        return res.json(result);
    });
});

router.put("/update/:id", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid supplier ID."
        });
    }

    const checked = cleanAndValidate(req.body);

    if (checked.error) {
        return res.status(400).json({
            success: false,
            message: checked.error
        });
    }

    const data = checked.data;

    checkDuplicateSupplier(data, id, (err, duplicate) => {
        if (err) {
            console.log("UPDATE SUPPLIER CHECK ERROR:", err);

            return res.status(500).json({
                success: false,
                message: "Database Error"
            });
        }

        if (duplicate) {
            return res.status(409).json({
                success: false,
                message: duplicate.error
            });
        }

        const sql = `
            UPDATE suppliers
            SET
                supplier_code = ?,
                supplier_name = ?,
                contact_number = ?,
                email = ?,
                address = ?
            WHERE id = ?
        `;

        db.query(
            sql,
            [
                data.supplier_code,
                data.supplier_name,
                data.contact_number,
                data.email,
                data.address,
                id
            ],
            (err, result) => {
                if (err) {
                    console.log("UPDATE SUPPLIER ERROR:", err);

                    if (err.code === "ER_DUP_ENTRY") {
                        return res.status(409).json({
                            success: false,
                            message: "Supplier Code or supplier information already exists."
                        });
                    }

                    return res.status(500).json({
                        success: false,
                        message: "Failed to update supplier."
                    });
                }

                if (result.affectedRows === 0) {
                    return db.query(
                        "SELECT id FROM suppliers WHERE id = ?",
                        [id],
                        (checkErr, existing) => {
                            if (checkErr) {
                                return res.status(500).json({
                                    success: false,
                                    message: "Database Error"
                                });
                            }

                            if (existing.length === 0) {
                                return res.status(404).json({
                                    success: false,
                                    message: "Supplier not found."
                                });
                            }

                            return res.json({
                                success: true,
                                message: "Supplier details are already up to date."
                            });
                        }
                    );
                }

                console.log("Supplier updated successfully. ID:", id);

                return res.json({
                    success: true,
                    message: "Supplier Updated Successfully!"
                });
            }
        );
    });
});

module.exports = router;
