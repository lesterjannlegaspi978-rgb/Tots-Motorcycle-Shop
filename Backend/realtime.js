const clients = new Set();

function addClient(response) {
    clients.add(response);
    response.on("close", () => clients.delete(response));
}

function publishUpdate(types) {
    const updates = [...new Set(Array.isArray(types) ? types : [types])];
    const message = `data: ${JSON.stringify({ types: updates })}\n\n`;

    for (const client of clients) {
        client.write(message);
    }
}

module.exports = {
    addClient,
    publishUpdate
};
