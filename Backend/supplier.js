const express = require("express");
const router = express.Router();
const db = require("./db");

function isValidSupplierCode(value) {
    return /^SUP\d{3}$/.test(value);
}

function isValidSupplierName(value) {
    return /^[A-Za-z0-9&.,'()\- ]{2,150}$/.test(value);
}

function isValidContactPerson(value) {
    return /^[A-Za-z][A-Za-z .'-]{1,99}$/.test(value);
}

function isValidPhilippineMobile(value) {
    return /^09\d{9}$/.test(value);
}

function isValidGmail(value) {
    const gmailPattern =
        /^[a-z0-9][a-z0-9._%+-]*@gmail\.com$/i;

    if (!gmailPattern.test(value)) {
        return false;
    }

    const localPart = value.split("@")[0];

    if (
        localPart.startsWith(".") ||
        localPart.endsWith(".")
    ) {
        return false;
    }

    if (localPart.includes("..")) {
        return false;
    }

    return true;
}

function isValidAddress(value) {
    return (
        value.length >= 5 &&
        value.length <= 255
    );
}

router.post("/add", (req, res) => {
    let {
        supplier_code,
        supplier_name,
        contact_person,
        contact_number,
        email,
        address
    } = req.body;

    supplier_code = String(supplier_code || "")
        .trim()
        .toUpperCase();

    supplier_name = String(supplier_name || "").trim();
    contact_person = String(contact_person || "").trim();
    contact_number = String(contact_number || "").trim();
    email = String(email || "").trim().toLowerCase();
    address = String(address || "").trim();

    if (
        !supplier_code ||
        !supplier_name ||
        !contact_person ||
        !contact_number ||
        !email ||
        !address
    ) {
        return res.status(400).json({
            success: false,
            message: "Please complete all required supplier fields."
        });
    }

    if (!isValidSupplierCode(supplier_code)) {
        return res.status(400).json({
            success: false,
            message: "Supplier Code must follow the format SUP001."
        });
    }

    if (!isValidSupplierName(supplier_name)) {
        return res.status(400).json({
            success: false,
            message: "Supplier Name contains invalid characters."
        });
    }

    if (!isValidContactPerson(contact_person)) {
        return res.status(400).json({
            success: false,
            message: "Contact Person must contain a valid name using letters, spaces, hyphens, or apostrophes."
        });
    }

    if (!isValidPhilippineMobile(contact_number)) {
        return res.status(400).json({
            success: false,
            message: "Contact Number must contain exactly 11 digits and start with 09."
        });
    }

    if (!isValidGmail(email)) {
        return res.status(400).json({
            success: false,
            message: "Please enter a valid Gmail address ending in @gmail.com."
        });
    }

    if (!isValidAddress(address)) {
        return res.status(400).json({
            success: false,
            message: "Please enter a valid supplier address."
        });
    }

    const checkCodeSql = `
        SELECT id
        FROM suppliers
        WHERE supplier_code = ?
        LIMIT 1
    `;

    db.query(checkCodeSql, [supplier_code], (err, result) => {
        if (err) {
            console.log("CHECK SUPPLIER CODE ERROR:", err);

            return res.status(500).json({
                success: false,
                message: "Database Error"
            });
        }

        if (result.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Supplier Code already exists."
            });
        }

        const checkNameSql = `
            SELECT id
            FROM suppliers
            WHERE LOWER(supplier_name) = LOWER(?)
            LIMIT 1
        `;

        db.query(checkNameSql, [supplier_name], (err, result) => {
            if (err) {
                console.log("CHECK SUPPLIER NAME ERROR:", err);

                return res.status(500).json({
                    success: false,
                    message: "Database Error"
                });
            }

            if (result.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: "Supplier Name already exists."
                });
            }

            const checkEmailSql = `
                SELECT id
                FROM suppliers
                WHERE LOWER(email) = LOWER(?)
                LIMIT 1
            `;

            db.query(checkEmailSql, [email], (err, result) => {
                if (err) {
                    console.log("CHECK SUPPLIER EMAIL ERROR:", err);

                    return res.status(500).json({
                        success: false,
                        message: "Database Error"
                    });
                }

                if (result.length > 0) {
                    return res.status(409).json({
                        success: false,
                        message: "This Gmail address is already registered to a supplier."
                    });
                }

                const checkContactSql = `
                    SELECT id
                    FROM suppliers
                    WHERE contact_number = ?
                    LIMIT 1
                `;

                db.query(checkContactSql, [contact_number], (err, result) => {
                    if (err) {
                        console.log("CHECK SUPPLIER CONTACT ERROR:", err);

                        return res.status(500).json({
                            success: false,
                            message: "Database Error"
                        });
                    }

                    if (result.length > 0) {
                        return res.status(409).json({
                            success: false,
                            message: "This contact number is already registered to a supplier."
                        });
                    }

                    const sql = `
                        INSERT INTO suppliers (
                            supplier_code,
                            supplier_name,
                            contact_person,
                            contact_number,
                            email,
                            address
                        )
                        VALUES (?, ?, ?, ?, ?, ?)
                    `;

                    db.query(
                        sql,
                        [
                            supplier_code,
                            supplier_name,
                            contact_person,
                            contact_number,
                            email,
                            address
                        ],
                        (err, result) => {
                            if (err) {
                                console.log("ADD SUPPLIER ERROR:", err);

                                return res.status(500).json({
                                    success: false,
                                    message: "Failed to add supplier."
                                });
                            }

                            console.log(
                                "Supplier added successfully. ID:",
                                result.insertId
                            );

                            return res.status(201).json({
                                success: true,
                                message: "Supplier Added Successfully!"
                            });
                        }
                    );
                });
            });
        });
    });
});

router.get("/all", (req, res) => {
    const sql = `
        SELECT
            id,
            supplier_code,
            supplier_name,
            contact_person,
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
    const id = req.params.id;

    let {
        supplier_code,
        supplier_name,
        contact_person,
        contact_number,
        email,
        address
    } = req.body;

    supplier_code = String(supplier_code || "")
        .trim()
        .toUpperCase();

    supplier_name = String(supplier_name || "").trim();
    contact_person = String(contact_person || "").trim();
    contact_number = String(contact_number || "").trim();
    email = String(email || "").trim().toLowerCase();
    address = String(address || "").trim();

    if (
        !supplier_code ||
        !supplier_name ||
        !contact_person ||
        !contact_number ||
        !email ||
        !address
    ) {
        return res.status(400).json({
            success: false,
            message: "Please complete all required supplier fields."
        });
    }

    if (!isValidSupplierCode(supplier_code)) {
        return res.status(400).json({
            success: false,
            message: "Supplier Code must follow the format SUP001."
        });
    }

    if (!isValidSupplierName(supplier_name)) {
        return res.status(400).json({
            success: false,
            message: "Supplier Name contains invalid characters."
        });
    }

    if (!isValidContactPerson(contact_person)) {
        return res.status(400).json({
            success: false,
            message: "Contact Person must contain a valid name."
        });
    }

    if (!isValidPhilippineMobile(contact_number)) {
        return res.status(400).json({
            success: false,
            message: "Contact Number must contain exactly 11 digits and start with 09."
        });
    }

    if (!isValidGmail(email)) {
        return res.status(400).json({
            success: false,
            message: "Please enter a valid Gmail address ending in @gmail.com."
        });
    }

    if (!isValidAddress(address)) {
        return res.status(400).json({
            success: false,
            message: "Please enter a valid supplier address."
        });
    }

    const duplicateSql = `
        SELECT
            id,
            supplier_code,
            supplier_name,
            email,
            contact_number
        FROM suppliers
        WHERE id <> ?
        AND (
            supplier_code = ?
            OR LOWER(supplier_name) = LOWER(?)
            OR LOWER(email) = LOWER(?)
            OR contact_number = ?
        )
        LIMIT 1
    `;

    db.query(
        duplicateSql,
        [
            id,
            supplier_code,
            supplier_name,
            email,
            contact_number
        ],
        (err, result) => {
            if (err) {
                console.log("UPDATE SUPPLIER CHECK ERROR:", err);

                return res.status(500).json({
                    success: false,
                    message: "Database Error"
                });
            }

            if (result.length > 0) {
                const existing = result[0];

                if (existing.supplier_code === supplier_code) {
                    return res.status(409).json({
                        success: false,
                        message: "Supplier Code already exists."
                    });
                }

                if (
                    existing.supplier_name.toLowerCase() ===
                    supplier_name.toLowerCase()
                ) {
                    return res.status(409).json({
                        success: false,
                        message: "Supplier Name already exists."
                    });
                }

                if (
                    existing.email.toLowerCase() ===
                    email.toLowerCase()
                ) {
                    return res.status(409).json({
                        success: false,
                        message: "This Gmail address is already registered to another supplier."
                    });
                }

                if (existing.contact_number === contact_number) {
                    return res.status(409).json({
                        success: false,
                        message: "This contact number is already registered to another supplier."
                    });
                }
            }

            const sql = `
                UPDATE suppliers
                SET
                    supplier_code = ?,
                    supplier_name = ?,
                    contact_person = ?,
                    contact_number = ?,
                    email = ?,
                    address = ?
                WHERE id = ?
            `;

            db.query(
                sql,
                [
                    supplier_code,
                    supplier_name,
                    contact_person,
                    contact_number,
                    email,
                    address,
                    id
                ],
                (err, result) => {
                    if (err) {
                        console.log("UPDATE SUPPLIER ERROR:", err);

                        return res.status(500).json({
                            success: false,
                            message: "Failed to update supplier."
                        });
                    }

                    if (result.affectedRows === 0) {
                        return res.status(404).json({
                            success: false,
                            message: "Supplier not found."
                        });
                    }

                    console.log(
                        "Supplier updated successfully. ID:",
                        id
                    );

                    return res.json({
                        success: true,
                        message: "Supplier Updated Successfully!"
                    });
                }
            );
        }
    );
});

router.delete("/delete/:id", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid supplier ID."
        });
    }

    const sql = "DELETE FROM suppliers WHERE id = ?";

    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error("DELETE SUPPLIER ERROR:", err);

            if (
                err.code === "ER_ROW_IS_REFERENCED_2" ||
                err.code === "ER_ROW_IS_REFERENCED"
            ) {
                return res.status(409).json({
                    success: false,
                    message: "Cannot delete this supplier because it is being used by other records."
                });
            }

            return res.status(500).json({
                success: false,
                message: "Failed to delete supplier."
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Supplier not found."
            });
        }

        console.log("Supplier deleted successfully. ID:", id);

        return res.json({
            success: true,
            message: "Supplier Deleted Successfully!"
        });
    });
});

module.exports = router;