(function () {
    const subscribers = new Set();
    let active = false;
    let controller = null;

    function wait(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    window.hasRealtimeUpdate = function (update, type) {
        return Array.isArray(update.types)
            ? update.types.includes(type)
            : update.type === type;
    };

    async function connect() {
        if (active) {
            return;
        }

        active = true;

        while (subscribers.size > 0) {
            controller = new AbortController();

            try {
                const response = await fetch("/realtime/events", {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`
                    },
                    signal: controller.signal
                });

                if (response.status === 401) {
                    localStorage.removeItem("authToken");
                    window.location.replace("login.html");
                    break;
                }

                if (!response.ok || !response.body) {
                    throw new Error("Realtime connection failed.");
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (subscribers.size > 0) {
                    const { value, done } = await reader.read();

                    if (done) {
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    const messages = buffer.split(/\r?\n\r?\n/);
                    buffer = messages.pop() || "";

                    for (const message of messages) {
                        const dataLine = message
                            .split(/\r?\n/)
                            .find(line => line.startsWith("data:"));

                        if (!dataLine) {
                            continue;
                        }

                        const update = JSON.parse(dataLine.slice(5).trim());

                        for (const subscriber of subscribers) {
                            subscriber(update);
                        }
                    }
                }
            } catch (error) {
                if (controller.signal.aborted) {
                    break;
                }
            }

            if (subscribers.size > 0) {
                await wait(1500);
            }
        }

        active = false;
        controller = null;

        if (subscribers.size > 0) {
            connect();
        }
    }

    window.subscribeRealtimeUpdates = function (callback) {
        subscribers.add(callback);
        connect();

        return function () {
            subscribers.delete(callback);

            if (subscribers.size === 0 && controller) {
                controller.abort();
            }
        };
    };
})();
